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

/**
 * Nucleas measures its free models by running them: which request features the host supports
 * (forced JSON, tool calls) and how well each model does the small jobs Ask hands it: deciding
 * what a request is, calling the right tool, answering only from given facts. Checks cost nothing
 * on free models and take the shared lock like any chat, one model at a time.
 */

type Message = { role: 'system' | 'user' | 'assistant'; content: string };
type ResponseFormat = ModelRequest['responseFormat'];
export type JsonMode = 'json_schema' | 'json_object' | 'prompt';

/** How the checks reach a model; the real one goes through the gateway, tests pass a fake. */
export interface CheckCaller {
  plain(messages: Message[], format?: ResponseFormat): Promise<{ text: string; latencyMs: number }>;
  tools(messages: Message[], tools: ToolDefinition[]): Promise<{ text: string; toolCalls: { name: string; arguments: string }[]; latencyMs: number }>;
}

export interface CheckOutcome {
  supports: { jsonSchema: boolean; jsonObject: boolean; tools: boolean };
  jsonMode: JsonMode;
  scores: CheckScores;
  overall: number;
  avgLatencyMs: number | null;
  notes: string[];
}

/** The host refused the request shape (unsupported parameter), as opposed to being down. */
function refusedShape(error: unknown): boolean {
  return error instanceof GatewayError && (error.details?.httpStatus === 400 || error.details?.httpStatus === 422);
}

export const ROUTES = ['answer', 'code_change', 'job'] as const;
export type Route = (typeof ROUTES)[number];

export const ROUTE_SYSTEM = [
  'You sort requests sent to Nucleas, the operating system for a group of companies.',
  'answer: a question about the companies, their numbers or their work that can be answered now.',
  'code_change: a change to a website or app (fix, remove, add or edit something on a page or in the code).',
  'job: non-code work to carry out once or on a repeat (research, collecting details into a catalog, outreach, content).',
  'Reply with JSON only: {"route": "answer" | "code_change" | "job"}.',
].join('\n');

export const ROUTE_SCHEMA = {
  type: 'object',
  properties: { route: { type: 'string', enum: [...ROUTES] } },
  required: ['route'],
  additionalProperties: false,
};

const ROUTING_CASES: { request: string; route: Route }[] = [
  { request: "How many visitors did PlayBound get last week compared to the week before?", route: 'answer' },
  { request: 'On the game servers page, remove the OpenHV listing that shows under OpenRA.', route: 'code_change' },
  { request: 'Every day, earn one dofollow backlink for a PlayBound page.', route: 'job' },
  { request: 'The footer on frugalgambler.club has a typo in the copyright line, fix it.', route: 'code_change' },
  { request: 'Research the game Factorio in detail and add its details to the PlayBound catalog.', route: 'job' },
  { request: 'Which of our companies made the most revenue this month?', route: 'answer' },
];

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

const CHECK_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'company_metrics',
      description: "Read a company's recorded numbers: visitors, revenue or signups over a period.",
      parameters: {
        type: 'object',
        properties: {
          company: { type: 'string', description: 'Company name' },
          metric: { type: 'string', enum: ['visitors', 'revenue', 'signups'] },
          days: { type: 'integer', description: 'How many days back' },
        },
        required: ['company', 'metric'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo_search',
      description: "Search a company's code repository for text and return matching files and lines.",
      parameters: {
        type: 'object',
        properties: { company: { type: 'string' }, query: { type: 'string', description: 'Text to find' } },
        required: ['company', 'query'],
      },
    },
  },
];

const TOOL_CASES: { request: string; expect: (name: string, args: Record<string, unknown>) => boolean }[] = [
  {
    request: 'How many visitors did Playbound.club have in the last 7 days?',
    expect: (name, args) => name === 'company_metrics' && /playbound/i.test(String(args.company)) && args.metric === 'visitors',
  },
  {
    request: 'Where in the PlayBound code is the OpenHV game server listing defined?',
    expect: (name, args) => name === 'repo_search' && /openhv/i.test(String(args.query)),
  },
];

const FACTS = 'PlayBound release notes. Version 2.3 shipped on 14 August 2026 and added 41 new games. The catalog now holds 1,204 games. Search was rebuilt to rank by player count.';
const GROUNDED_SYSTEM = `Answer only from these notes. If the notes do not say, reply that the notes do not say.\n\n${FACTS}`;
const GROUNDED_CASES: { question: string; pass: (text: string) => boolean }[] = [
  { question: 'How many games does the catalog hold now?', pass: (t) => /1[,.\s]?204/.test(t) },
  { question: 'When did version 2.3 ship?', pass: (t) => /14/.test(t) && /aug/i.test(t) },
  {
    question: 'Who designed the new logo in version 2.3?',
    pass: (t) => /(not|n't)\s+(say|said|mention|state|specif|includ|provide|contain)|no (information|mention|details?)|unknown|not (in|found in) the notes/i.test(t),
  },
];

function formatFor(mode: JsonMode, name: string, schema: Record<string, unknown>): ResponseFormat {
  if (mode === 'json_schema') return { type: 'json_schema', name, schema };
  if (mode === 'json_object') return { type: 'json_object' };
  return undefined;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round = (n: number) => Math.round(n * 100) / 100;

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

  // 2. Routing, in the best JSON mode the host offers.
  onProgress?.('Checking request routing');
  const routed: number[] = [];
  for (const item of ROUTING_CASES) {
    const reply = await caller.plain(
      [
        { role: 'system', content: ROUTE_SYSTEM },
        { role: 'user', content: item.request },
      ],
      formatFor(jsonMode, 'route', ROUTE_SCHEMA)
    );
    latencies.push(reply.latencyMs);
    const parsed = extractJson(reply.text) as { route?: unknown } | null;
    jsonResults.push(parsed && (ROUTES as readonly string[]).includes(String(parsed.route)) ? 1 : 0);
    const correct = parsed?.route === item.route;
    routed.push(correct ? 1 : 0);
    if (!correct) notes.push(`Routed "${item.request.slice(0, 50)}…" as ${parsed?.route ?? 'nothing'} (expected ${item.route}).`);
  }

  // 3. Tool calls.
  onProgress?.('Checking tool calls');
  const toolResults: number[] = [];
  for (const item of TOOL_CASES) {
    try {
      const reply = await caller.tools(
        [
          { role: 'system', content: 'You help run a group of companies. Use a tool when it can answer the request.' },
          { role: 'user', content: item.request },
        ],
        CHECK_TOOLS
      );
      latencies.push(reply.latencyMs);
      supports.tools = true;
      const call = reply.toolCalls[0];
      let args: Record<string, unknown> = {};
      try {
        args = call ? (JSON.parse(call.arguments || '{}') as Record<string, unknown>) : {};
      } catch {
        notes.push('Tool arguments were not valid JSON.');
      }
      const ok = Boolean(call && item.expect(call.name, args));
      toolResults.push(ok ? 1 : 0);
      if (!ok) notes.push(call ? `Called ${call.name} wrongly for "${item.request.slice(0, 40)}…".` : `No tool call for "${item.request.slice(0, 40)}…".`);
    } catch (error) {
      if (!refusedShape(error)) throw error;
      notes.push('Host refused tool calls.');
      toolResults.push(0);
      break;
    }
  }

  // 4. Grounded answers.
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
    if (!ok) notes.push(`Grounded answer missed: "${item.question}"`);
  }

  const scores: CheckScores = {
    json: round(mean(jsonResults)),
    routing: round(mean(routed)),
    tools: round(mean(toolResults)),
    grounded: round(mean(grounded)),
  };
  return {
    supports,
    jsonMode,
    scores,
    overall: round(mean([scores.json!, scores.routing!, scores.tools!, scores.grounded!])),
    avgLatencyMs: latencies.length ? Math.round(mean(latencies)) : null,
    notes: notes.slice(0, 12),
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
    async tools(messages, tools) {
      const r = await invokeModelWithTools(gateway, { role: 'worker', messages, maxOutputTokens: 4096, tools });
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
