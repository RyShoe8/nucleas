import 'server-only';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import type { ModelRequest, ToolDefinition } from '@nucleas/ai-contracts';
import { GatewayError, invokeModel, invokeModelWithTools } from '@nucleas/ai-core/gateway';
import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';
import { holdDispatchLock, releaseDispatchLock, waitForDispatchLock } from '@/lib/ai/control/dispatchLock';
import { extractJson } from '@/lib/ai/json';
import { listAvailableModels } from './catalog';
import { AiModelCheck, toCheckRow, type CheckScores, type ModelCheckRow } from './checkResults';
import { routerPrompt, routerUserMessage, routeSchema, parseDecision } from '@/lib/ai/company/directRouter';
import {
  applyEdits,
  CHECK_CODE_COMPANIES,
  CHECK_COMPANIES,
  CHECK_TOOLS,
  EDIT_CASES,
  EDIT_SCHEMA,
  EDIT_SYSTEM,
  GROUNDED_CASES,
  GROUNDED_SYSTEM,
  ROUTING_CASES,
  TOOL_CASES,
  type ToolMessages,
} from './checkCases';

/**
 * Nucleas measures its free models by running them: which request features the host supports
 * (forced JSON, tool calls) and how well each model does the small jobs Ask hands it: deciding
 * what a request is, calling the right tool, answering only from given facts, editing code exactly
 * (cases in checkCases.ts). Checks cost nothing
 * on free models and take the shared lock like any chat, one model at a time.
 */

type Message = { role: 'system' | 'user' | 'assistant'; content: string };
type ResponseFormat = ModelRequest['responseFormat'];
export type JsonMode = 'json_schema' | 'json_object' | 'prompt';

/** How the checks reach a model; the real one goes through the gateway, tests pass a fake. */
export interface CheckCaller {
  plain(messages: Message[], format?: ResponseFormat): Promise<{ text: string; latencyMs: number }>;
  tools(messages: ToolMessages, tools: ToolDefinition[], mode: ToolMode): Promise<{ text: string; toolCalls: { name: string; arguments: string }[]; latencyMs: number }>;
}

export type ToolMode = 'native' | 'prompted';

export interface CheckOutcome {
  supports: { jsonSchema: boolean; jsonObject: boolean; tools: boolean };
  jsonMode: JsonMode;
  /** How chats should give this model tools: whichever mode scored better (native on a tie). */
  toolMode: ToolMode;
  scores: CheckScores;
  overall: number;
  avgLatencyMs: number | null;
  notes: string[];
}

/** The host refused the request shape (unsupported parameter), as opposed to being down. */
function refusedShape(error: unknown): boolean {
  return error instanceof GatewayError && (error.details?.httpStatus === 400 || error.details?.httpStatus === 422);
}

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: { city: { type: 'string' }, population: { type: 'integer' } },
  required: ['city', 'population'],
  additionalProperties: false,
};
const EXTRACT_MESSAGES: Message[] = [
  { role: 'system', content: 'Extract facts. Reply with JSON only: {"city": string, "population": integer}.' },
  { role: 'user', content: 'Springfield, the county seat, counted 167,882 residents in its latest census.' },
];

function formatFor(mode: JsonMode, name: string, schema: Record<string, unknown>): ResponseFormat {
  if (mode === 'json_schema') return { type: 'json_schema', name, schema };
  if (mode === 'json_object') return { type: 'json_object' };
  return undefined;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round = (n: number) => Math.round(n * 100) / 100;
const clip = (text: string, n = 100) => text.replace(/\s+/g, ' ').trim().slice(0, n);

/** Runs every check against one model. Transport failures propagate; refused request shapes are recorded. */
export async function checkModel(caller: CheckCaller, onProgress?: (text: string) => void): Promise<CheckOutcome> {
  const notes: string[] = [];
  const latencies: number[] = [];
  const jsonResults: number[] = [];

  // 1. Forced JSON: schema-guided first, then any-object, then prompt only.
  const supports = { jsonSchema: false, jsonObject: false, tools: false };
  let jsonMode: JsonMode = 'prompt';
  onProgress?.('Checking forced JSON');
  for (const mode of ['json_schema', 'json_object', 'prompt'] as const) {
    try {
      const reply = await caller.plain(EXTRACT_MESSAGES, formatFor(mode, 'extract', EXTRACT_SCHEMA));
      latencies.push(reply.latencyMs);
      const parsed = extractJson(reply.text) as { city?: unknown; population?: unknown } | null;
      const valid = Boolean(parsed && /springfield/i.test(String(parsed.city)) && Number(parsed.population) === 167882);
      if (mode === 'json_schema') supports.jsonSchema = true;
      if (mode === 'json_object') supports.jsonObject = true;
      jsonResults.push(valid ? 1 : 0);
      if (!valid) notes.push(`Extraction with ${mode} was wrong or not JSON.`);
      jsonMode = mode;
      break;
    } catch (error) {
      if (!refusedShape(error)) throw error;
      notes.push(`Host refused response_format ${mode}.`);
    }
  }
  if (supports.jsonSchema) supports.jsonObject = true;

  // 2. Routing with the real Direct-mode router prompt: route and company both count.
  onProgress?.('Checking request routing');
  const routed: number[] = [];
  for (const item of ROUTING_CASES) {
    const reply = await caller.plain(
      [
        { role: 'system', content: routerPrompt(CHECK_COMPANIES, CHECK_CODE_COMPANIES) },
        { role: 'user', content: routerUserMessage(item.prior ?? [], item.text) },
      ],
      formatFor(jsonMode, 'route', routeSchema(CHECK_COMPANIES))
    );
    latencies.push(reply.latencyMs);
    const decision = parseDecision(reply.text, CHECK_COMPANIES, item.text);
    jsonResults.push(decision ? 1 : 0);
    const routeOk = decision?.route === item.route;
    const companyOk = decision ? decision.company === item.company : false;
    routed.push(routeOk ? (companyOk ? 1 : 0.5) : 0);
    if (!routeOk || !companyOk) notes.push(`Routing "${clip(item.text, 50)}": got ${decision ? `${decision.route} / ${decision.company ?? 'none'}` : 'no decision'}, expected ${item.route} / ${item.company ?? 'none'}.`);
  }

  // 3. Tool calls: the provider's tools parameter first; when that misses, tools described in the
  // prompt (hosts whose chat template drops tools). Chats use whichever mode scored better.
  onProgress?.('Checking tool calls');
  const runToolCases = async (mode: ToolMode) => {
    const results: number[] = [];
    const modeNotes: string[] = [];
    let accepted = false;
    for (const item of TOOL_CASES) {
      try {
        const reply = await caller.tools(item.messages, CHECK_TOOLS, mode);
        latencies.push(reply.latencyMs);
        accepted = true;
        const raw = reply.toolCalls[0];
        let call: { name: string; args: Record<string, unknown> } | null = null;
        if (raw) {
          try {
            call = { name: raw.name, args: JSON.parse(raw.arguments || '{}') as Record<string, unknown> };
          } catch {
            call = { name: raw.name, args: {} };
            modeNotes.push(`${mode}: tool arguments were not valid JSON (${item.label}).`);
          }
        }
        const ok = item.expect(call);
        results.push(ok ? 1 : 0);
        if (!ok) {
          modeNotes.push(
            raw ? `${mode} (${item.label}): called ${raw.name} ${clip(raw.arguments, 80)}` : `${mode} (${item.label}): no tool call; replied: ${clip(reply.text) || '(nothing)'}`
          );
        }
      } catch (error) {
        if (!refusedShape(error)) throw error;
        modeNotes.push(`${mode}: host refused tool calls.`);
        results.push(0);
        break;
      }
    }
    return { score: mean(results), notes: modeNotes, accepted };
  };
  const native = await runToolCases('native');
  supports.tools = native.accepted;
  let toolMode: ToolMode = 'native';
  let toolScore = native.score;
  let toolNotes = native.notes;
  if (native.score < 1) {
    onProgress?.('Checking tools described in the prompt');
    const prompted = await runToolCases('prompted');
    if (prompted.score > native.score) {
      toolMode = 'prompted';
      toolScore = prompted.score;
      toolNotes = prompted.notes;
    }
  }
  notes.push(...toolNotes);

  // 4. Grounded answers: combine facts, resist common knowledge, admit what the notes do not say.
  onProgress?.('Checking grounded answers');
  const grounded: number[] = [];
  for (const item of GROUNDED_CASES) {
    const reply = await caller.plain([
      { role: 'system', content: GROUNDED_SYSTEM },
      { role: 'user', content: item.question },
    ]);
    latencies.push(reply.latencyMs);
    const ok = item.pass(reply.text);
    grounded.push(ok ? 1 : 0);
    if (!ok) notes.push(`Grounded "${item.question}": ${clip(reply.text)}`);
  }

  // 5. Code edits, scored by applying them.
  onProgress?.('Checking code edits');
  const coded: number[] = [];
  for (const item of EDIT_CASES) {
    const reply = await caller.plain(
      [
        { role: 'system', content: EDIT_SYSTEM },
        { role: 'user', content: `File ${item.path}:\n\`\`\`ts\n${item.file}\`\`\`\n\nTask: ${item.task}` },
      ],
      formatFor(jsonMode, 'edits', EDIT_SCHEMA)
    );
    latencies.push(reply.latencyMs);
    const parsed = extractJson(reply.text) as { edits?: unknown } | null;
    jsonResults.push(parsed && Array.isArray(parsed.edits) ? 1 : 0);
    const result = parsed ? applyEdits(item.file, parsed.edits) : null;
    const ok = result !== null && item.pass(result);
    coded.push(ok ? 1 : 0);
    if (!ok) notes.push(`Code edit (${item.label}): ${result === null ? 'edits did not apply' : 'wrong result'}.`);
  }

  const scores: CheckScores = {
    json: round(mean(jsonResults)),
    routing: round(mean(routed)),
    tools: round(toolScore),
    grounded: round(mean(grounded)),
    code: round(mean(coded)),
  };
  return {
    supports,
    jsonMode,
    toolMode,
    scores,
    overall: round(mean([scores.json!, scores.routing!, scores.tools!, scores.grounded!, scores.code!])),
    avgLatencyMs: latencies.length ? Math.round(mean(latencies)) : null,
    notes: notes.slice(0, 20),
  };
}

/** The real caller: the credential's gateway, small outputs, plain chat or tools. */
async function gatewayCaller(profileId: string, model: string): Promise<CheckCaller> {
  const { gateway } = await gatewayFromModelProfile(profileId, model);
  return {
    async plain(messages, format) {
      const r = await invokeModel(gateway, { role: 'worker', messages, maxOutputTokens: 4096, ...(format ? { responseFormat: format } : {}) });
      return { text: r.content, latencyMs: r.latencyMs };
    },
    async tools(messages, tools, mode) {
      const r = await invokeModelWithTools({ ...gateway, toolMode: mode }, { role: 'worker', messages, maxOutputTokens: 4096, tools });
      return { text: r.content, toolCalls: r.toolCalls.map((c) => ({ name: c.function.name, arguments: c.function.arguments })), latencyMs: r.latencyMs };
    },
  };
}

/** Queues every free model the engine can see; earlier results stay in use until the new ones land. */
export async function queueModelChecks(): Promise<number> {
  const free = (await listAvailableModels()).filter((m) => m.free && !m.benched);
  const now = new Date();
  for (const m of free) {
    await AiModelCheck.updateOne(
      { profileId: new Types.ObjectId(m.profileId), model: m.model, status: { $ne: 'running' } },
      { $set: { status: 'queued', queuedAt: now }, $unset: { error: '' } },
      { upsert: true }
    ).catch((error: { code?: number }) => {
      // The row is running (the filter missed and the upsert hit the unique index): leave it.
      if (error?.code !== 11000) throw error;
    });
  }
  return free.length;
}

const STALE_RUNNING_MS = 15 * 60 * 1000;
const LOCK_HOLD_MS = 10 * 60 * 1000;

/** Runs queued checks one model at a time until the time budget is spent. */
export async function runQueuedModelChecks(options: { budgetMs?: number; caller?: (profileId: string, model: string) => Promise<CheckCaller> } = {}): Promise<{ checked: number }> {
  const deadline = Date.now() + (options.budgetMs ?? 240_000);
  let checked = 0;
  while (Date.now() < deadline) {
    const now = new Date();
    const claimed = await AiModelCheck.findOneAndUpdate(
      { $or: [{ status: 'queued' }, { status: 'running', startedAt: { $lt: new Date(now.getTime() - STALE_RUNNING_MS) } }] },
      { $set: { status: 'running', startedAt: now } },
      { sort: { queuedAt: 1 }, new: true }
    ).lean<{ _id: Types.ObjectId; profileId: Types.ObjectId; model: string }>();
    if (!claimed) break;

    const token = randomUUID();
    try {
      await waitForDispatchLock();
    } catch {
      // The shared model is busy with chats; try again on the next pass.
      await AiModelCheck.updateOne({ _id: claimed._id }, { $set: { status: 'queued' } });
      break;
    }
    await holdDispatchLock(token, LOCK_HOLD_MS);
    try {
      const caller = await (options.caller ?? gatewayCaller)(String(claimed.profileId), claimed.model);
      const outcome = await checkModel(caller);
      await AiModelCheck.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: 'done',
            checkedAt: new Date(),
            supports: outcome.supports,
            scores: outcome.scores,
            overall: outcome.overall,
            avgLatencyMs: outcome.avgLatencyMs,
            notes: outcome.notes,
            toolMode: outcome.toolMode,
          },
          $unset: { error: '' },
        }
      );
      checked += 1;
    } catch (error) {
      const message =
        error instanceof GatewayError ? `${error.code}${error.details?.httpStatus ? ` (${error.details.httpStatus})` : ''}${error.details?.providerMessage ? `: ${error.details.providerMessage}` : ''}` : 'Check failed.';
      await AiModelCheck.updateOne({ _id: claimed._id }, { $set: { status: 'failed', error: message.slice(0, 300) } });
    } finally {
      await releaseDispatchLock(token);
    }
  }
  return { checked };
}

export async function listModelChecks(): Promise<ModelCheckRow[]> {
  const docs = await AiModelCheck.find({}).sort({ model: 1 }).lean();
  return docs.map((d) => toCheckRow(d as never));
}
