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

export const CHECK_STAGES = ['json', 'routing', 'tools', 'grounded', 'code'] as const;
export type CheckStage = (typeof CHECK_STAGES)[number];

/** Rough model calls per stage (tools may run twice: native, then prompted), to fit stages into the time left. */
const STAGE_CALLS: Record<CheckStage, number> = {
  json: 2,
  routing: ROUTING_CASES.length,
  tools: TOOL_CASES.length * 2,
  grounded: GROUNDED_CASES.length,
  code: EDIT_CASES.length,
};

/** Everything measured so far; saved after each stage so a check cut off mid-way resumes. */
export interface CheckProgress {
  done: CheckStage[];
  supports: { jsonSchema: boolean; jsonObject: boolean; tools: boolean };
  jsonMode: JsonMode;
  toolMode: ToolMode;
  notes: string[];
  latencies: number[];
  jsonResults: number[];
  routed: number[];
  toolScore: number | null;
  grounded: number[];
  coded: number[];
  /** Gateway timeouts survived so far; the check is re-queued instead of failed until this runs out. */
  transientRetries?: number;
}

export function newProgress(): CheckProgress {
  return {
    done: [],
    supports: { jsonSchema: false, jsonObject: false, tools: false },
    jsonMode: 'prompt',
    toolMode: 'native',
    notes: [],
    latencies: [],
    jsonResults: [],
    routed: [],
    toolScore: null,
    grounded: [],
    coded: [],
  };
}

/** Runs one stage against one model, adding its results to the progress. Transport failures propagate. */
export async function runCheckStage(caller: CheckCaller, stage: CheckStage, p: CheckProgress, onProgress?: (text: string) => void): Promise<void> {
  switch (stage) {
    case 'json': {
      // Forced JSON: schema-guided first, then any-object, then prompt only.
      onProgress?.('Checking forced JSON');
      for (const mode of ['json_schema', 'json_object', 'prompt'] as const) {
        try {
          const reply = await caller.plain(EXTRACT_MESSAGES, formatFor(mode, 'extract', EXTRACT_SCHEMA));
          p.latencies.push(reply.latencyMs);
          const parsed = extractJson(reply.text) as { city?: unknown; population?: unknown } | null;
          const valid = Boolean(parsed && /springfield/i.test(String(parsed.city)) && Number(parsed.population) === 167882);
          if (mode === 'json_schema') p.supports.jsonSchema = true;
          if (mode === 'json_object') p.supports.jsonObject = true;
          p.jsonResults.push(valid ? 1 : 0);
          if (!valid) p.notes.push(`Extraction with ${mode} was wrong or not JSON.`);
          p.jsonMode = mode;
          break;
        } catch (error) {
          if (!refusedShape(error)) throw error;
          p.notes.push(`Host refused response_format ${mode}.`);
        }
      }
      if (p.supports.jsonSchema) p.supports.jsonObject = true;
      break;
    }

    case 'routing': {
      // The real Direct-mode router prompt: route and company both count.
      onProgress?.('Checking request routing');
      for (const item of ROUTING_CASES) {
        const reply = await caller.plain(
          [
            { role: 'system', content: routerPrompt(CHECK_COMPANIES, CHECK_CODE_COMPANIES) },
            { role: 'user', content: routerUserMessage(item.prior ?? [], item.text) },
          ],
          formatFor(p.jsonMode, 'route', routeSchema(CHECK_COMPANIES))
        );
        p.latencies.push(reply.latencyMs);
        const decision = parseDecision(reply.text, CHECK_COMPANIES, item.text);
        p.jsonResults.push(decision ? 1 : 0);
        const routeOk = decision?.route === item.route;
        const companyOk = decision ? decision.company === item.company : false;
        p.routed.push(routeOk ? (companyOk ? 1 : 0.5) : 0);
        if (!routeOk || !companyOk) p.notes.push(`Routing "${clip(item.text, 50)}": got ${decision ? `${decision.route} / ${decision.company ?? 'none'}` : 'no decision'}, expected ${item.route} / ${item.company ?? 'none'}.`);
      }
      break;
    }

    case 'tools': {
      // The provider's tools parameter first; when that misses, tools described in the prompt
      // (hosts whose chat template drops tools). Chats use whichever mode scored better.
      onProgress?.('Checking tool calls');
      const runToolCases = async (mode: ToolMode) => {
        const results: number[] = [];
        const modeNotes: string[] = [];
        let accepted = false;
        for (const item of TOOL_CASES) {
          try {
            const reply = await caller.tools(item.messages, CHECK_TOOLS, mode);
            p.latencies.push(reply.latencyMs);
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
      p.supports.tools = native.accepted;
      p.toolMode = 'native';
      p.toolScore = native.score;
      let toolNotes = native.notes;
      if (native.score < 1) {
        onProgress?.('Checking tools described in the prompt');
        const prompted = await runToolCases('prompted');
        if (prompted.score > native.score) {
          p.toolMode = 'prompted';
          p.toolScore = prompted.score;
          toolNotes = prompted.notes;
        }
      }
      p.notes.push(...toolNotes);
      break;
    }

    case 'grounded': {
      // Combine facts, resist common knowledge, admit what the notes do not say.
      onProgress?.('Checking grounded answers');
      for (const item of GROUNDED_CASES) {
        const reply = await caller.plain([
          { role: 'system', content: GROUNDED_SYSTEM },
          { role: 'user', content: item.question },
        ]);
        p.latencies.push(reply.latencyMs);
        const ok = item.pass(reply.text);
        p.grounded.push(ok ? 1 : 0);
        if (!ok) p.notes.push(`Grounded "${item.question}": ${clip(reply.text)}`);
      }
      break;
    }

    case 'code': {
      // Code edits, scored by applying them.
      onProgress?.('Checking code edits');
      for (const item of EDIT_CASES) {
        const reply = await caller.plain(
          [
            { role: 'system', content: EDIT_SYSTEM },
            { role: 'user', content: `File ${item.path}:\n\`\`\`ts\n${item.file}\`\`\`\n\nTask: ${item.task}` },
          ],
          formatFor(p.jsonMode, 'edits', EDIT_SCHEMA)
        );
        p.latencies.push(reply.latencyMs);
        const parsed = extractJson(reply.text) as { edits?: unknown } | null;
        p.jsonResults.push(parsed && Array.isArray(parsed.edits) ? 1 : 0);
        const result = parsed ? applyEdits(item.file, parsed.edits) : null;
        const ok = result !== null && item.pass(result);
        p.coded.push(ok ? 1 : 0);
        if (!ok) p.notes.push(`Code edit (${item.label}): ${result === null ? 'edits did not apply' : 'wrong result'}.`);
      }
      break;
    }
  }
  if (!p.done.includes(stage)) p.done.push(stage);
}

export function finishCheck(p: CheckProgress): CheckOutcome {
  const scores: CheckScores = {
    json: round(mean(p.jsonResults)),
    routing: round(mean(p.routed)),
    tools: round(p.toolScore ?? 0),
    grounded: round(mean(p.grounded)),
    code: round(mean(p.coded)),
  };
  return {
    supports: p.supports,
    jsonMode: p.jsonMode,
    toolMode: p.toolMode,
    scores,
    overall: round(mean([scores.json!, scores.routing!, scores.tools!, scores.grounded!, scores.code!])),
    avgLatencyMs: p.latencies.length ? Math.round(mean(p.latencies)) : null,
    notes: p.notes.slice(0, 20),
  };
}

/** Runs every stage against one model in one go (tests; admin runs go stage by stage). */
export async function checkModel(caller: CheckCaller, onProgress?: (text: string) => void): Promise<CheckOutcome> {
  const p = newProgress();
  for (const stage of CHECK_STAGES) await runCheckStage(caller, stage, p, onProgress);
  return finishCheck(p);
}

/** The real caller: the credential's gateway, small outputs, plain chat or tools. */
async function gatewayCaller(profileId: string, model: string): Promise<CheckCaller> {
  // Stream every check call: a reasoning model can think for over a minute before its first token,
  // and a reverse proxy in front of the host (nginx) answers 504 after 60s without bytes.
  const { gateway: base } = await gatewayFromModelProfile(profileId, model);
  const gateway = { ...base, stream: true };
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
      { $set: { status: 'queued', queuedAt: now }, $unset: { error: '', progress: '' } },
      { upsert: true }
    ).catch((error: { code?: number }) => {
      // The row is running (the filter missed and the upsert hit the unique index): leave it.
      if (error?.code !== 11000) throw error;
    });
  }
  return free.length;
}

/** A stage never runs longer than the route allows (300s), so a "running" row older than this was cut off. */
const STALE_RUNNING_MS = 6 * 60 * 1000;
const STAGE_LOCK_MS = 5 * 60 * 1000;
const DEFAULT_CALL_MS = 8_000;

const MAX_TRANSIENT_RETRIES = 3;

/** A host-side timeout or overload (nginx 502/503/504), common for slow reasoning models; worth retrying. */
function isTransientGatewayError(error: unknown): boolean {
  return error instanceof GatewayError && [502, 503, 504].includes(Number(error.details?.httpStatus));
}

function failureMessage(error: unknown): string {
  return error instanceof GatewayError ? `${error.code}${error.details?.httpStatus ? ` (${error.details.httpStatus})` : ''}${error.details?.providerMessage ? `: ${error.details.providerMessage}` : ''}` : 'Check failed.';
}

/**
 * Runs queued checks one stage at a time until the time budget is spent. Each stage takes the
 * shared lock and releases it (chats get turns in between) and is saved, so a slow model is
 * checked across several runs and a run cut off mid-stage only repeats that stage. A stage starts
 * only when it is expected to finish in the time left, except the first stage of a run.
 */
export async function runQueuedModelChecks(options: { budgetMs?: number; caller?: (profileId: string, model: string) => Promise<CheckCaller> } = {}): Promise<{ checked: number }> {
  const deadline = Date.now() + (options.budgetMs ?? 240_000);
  let checked = 0;
  let stagesThisRun = 0;
  while (Date.now() < deadline) {
    const now = new Date();
    const claimed = await AiModelCheck.findOneAndUpdate(
      { $or: [{ status: 'queued' }, { status: 'running', startedAt: { $lt: new Date(now.getTime() - STALE_RUNNING_MS) } }] },
      { $set: { status: 'running', startedAt: now } },
      { sort: { queuedAt: 1 }, new: true }
    ).lean<{ _id: Types.ObjectId; profileId: Types.ObjectId; model: string; progress?: CheckProgress | null }>();
    if (!claimed) break;

    const progress: CheckProgress = { ...newProgress(), ...(claimed.progress ?? {}) };
    let caller: CheckCaller;
    try {
      caller = await (options.caller ?? gatewayCaller)(String(claimed.profileId), claimed.model);
    } catch (error) {
      await AiModelCheck.updateOne({ _id: claimed._id }, { $set: { status: 'failed', error: failureMessage(error).slice(0, 300) }, $unset: { progress: '' } });
      continue;
    }

    let stopped = false;
    let failed = false;
    for (const stage of CHECK_STAGES.filter((st) => !progress.done.includes(st))) {
      const perCall = progress.latencies.length ? mean(progress.latencies) : DEFAULT_CALL_MS;
      const expected = STAGE_CALLS[stage] * perCall * 1.2;
      if (stagesThisRun > 0 && Date.now() + expected > deadline) {
        stopped = true;
        break;
      }
      const token = randomUUID();
      try {
        await waitForDispatchLock();
      } catch {
        // The shared model is busy with chats; pick up from here on the next run.
        stopped = true;
        break;
      }
      await holdDispatchLock(token, STAGE_LOCK_MS);
      try {
        await runCheckStage(caller, stage, progress);
        stagesThisRun += 1;
        await AiModelCheck.updateOne({ _id: claimed._id }, { $set: { progress, startedAt: new Date() } });
      } catch (error) {
        const retries = progress.transientRetries ?? 0;
        if (isTransientGatewayError(error) && retries < MAX_TRANSIENT_RETRIES) {
          // Keep finished stages and retry this one on the next run rather than discarding the check.
          progress.transientRetries = retries + 1;
          await AiModelCheck.updateOne({ _id: claimed._id }, { $set: { status: 'queued', progress } });
          // Not `failed`: the run ends here so the retry waits for the next run instead of
          // re-claiming this model at once and waiting out another gateway timeout.
          stopped = true;
          break;
        }
        await AiModelCheck.updateOne({ _id: claimed._id }, { $set: { status: 'failed', error: failureMessage(error).slice(0, 300) }, $unset: { progress: '' } });
        stopped = true;
        failed = true;
        break;
      } finally {
        await releaseDispatchLock(token);
      }
    }

    if (progress.done.length === CHECK_STAGES.length) {
      const outcome = finishCheck(progress);
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
          $unset: { error: '', progress: '' },
        }
      );
      checked += 1;
    } else if (stopped && !failed) {
      // Out of time or the model is busy: keep the progress and continue on the next run.
      await AiModelCheck.updateOne({ _id: claimed._id, status: 'running' }, { $set: { status: 'queued' } });
      break;
    }
  }
  return { checked };
}

export async function listModelChecks(): Promise<ModelCheckRow[]> {
  const docs = await AiModelCheck.find({}).sort({ model: 1 }).lean();
  return docs.map((d) => toCheckRow(d as never));
}
