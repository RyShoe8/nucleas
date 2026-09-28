import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EXECUTION_WORKER_FEATURES, executionWorkerRequestSchema, executionWorkerResponseSchema, type ExecutionWorkerRequest } from '../../packages/ai-contracts/src/execution';
import { assertWorkspacePath, deleteWorkspaceFile, readWorkspaceFile, runCommand, setWorkspaceOwner, writeWorkspaceFile, type CommandEvidence } from './runtime';

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
const MAX_BODY = 64 * 1024;
const SANDBOX_UID = 10001;
const SANDBOX_GID = 10001;
let busy = false;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function authorized(header: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${required('NUCLEAS_EXECUTION_WORKER_TOKEN')}`);
  const actual = Buffer.from(header ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function body(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length; if (size > MAX_BODY) throw new Error('Request body is too large.'); chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function listFiles(workspace: string, relative = ''): Promise<string[]> {
  const start = relative ? assertWorkspacePath(workspace, relative) : workspace;
  const root = await realpath(workspace); const rows: string[] = [];
  async function visit(current: string) {
    if (rows.length >= 500) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name); const rel = path.relative(root, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) await visit(absolute); else if (entry.isFile()) rows.push(rel);
      if (rows.length >= 500) return;
    }
  }
  await visit(start); return rows;
}

const tools = [
  { type: 'function', function: { name: 'list_files', description: 'List repository files, excluding Git metadata and dependencies.', parameters: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: 'Read one UTF-8 repository file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'write_file', description: 'Create or replace one UTF-8 repository file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'delete_file', description: 'Delete one regular repository file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'run_command', description: 'Run one argv command in the isolated repository. Shell syntax is not supported.', parameters: { type: 'object', properties: { argv: { type: 'array', minItems: 1, maxItems: 33, items: { type: 'string' } } }, required: ['argv'], additionalProperties: false } } },
  { type: 'function', function: { name: 'finish', description: 'Finish after implementation and verification.', parameters: { type: 'object', properties: { summary: { type: 'string' }, limitations: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['completed', 'blocked'] } }, required: ['summary', 'limitations', 'status'], additionalProperties: false } } },
] as const;

export type Inference = { endpoint: string; bearerToken: string; model: string };
export type Usage = { inputTokens: number; outputTokens: number; reported: boolean };

/** Request options a provider rejected once; later calls in the same build skip them. */
export type Quirks = { noTemperature: boolean; completionTokens: boolean };

export async function modelReply(messages: ChatMessage[], inference: Inference, usage: Usage, quirks: Quirks): Promise<{ content: string; toolCalls: ToolCall[]; reportedModel: string | null }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(inference.endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${inference.bearerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: inference.model, messages, tools, tool_choice: 'auto',
          ...(quirks.noTemperature ? {} : { temperature: 0.1 }),
          ...(quirks.completionTokens ? { max_completion_tokens: 8192 } : { max_tokens: 4096 }),
        }),
      });
      if (response.status === 400) {
        // Newer reasoning models reject temperature or max_tokens; adapt once and retry.
        const detail = (await response.text().catch(() => '')).slice(0, 2000);
        if (!quirks.completionTokens && /max_tokens|max_completion_tokens/.test(detail)) { quirks.completionTokens = true; continue; }
        if (!quirks.noTemperature && /temperature/.test(detail)) { quirks.noTemperature = true; continue; }
        throw new Error('Inference failed with HTTP 400.');
      }
      if (!response.ok) throw new Error(`Inference failed with HTTP ${response.status}.`);
      const payload = await response.json() as { model?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }; choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
      const message = payload.choices?.[0]?.message;
      if (!message) throw new Error('Inference returned no message.');
      if (typeof payload.usage?.prompt_tokens === 'number' && typeof payload.usage?.completion_tokens === 'number') {
        usage.inputTokens += payload.usage.prompt_tokens; usage.outputTokens += payload.usage.completion_tokens; usage.reported = true;
      }
      const reportedModel = typeof payload.model === 'string' && payload.model.trim() && payload.model.trim().length <= 200
        ? payload.model.trim() : null;
      return { content: message.content ?? '', toolCalls: message.tool_calls ?? [], reportedModel };
    } finally { clearTimeout(timer); }
  }
  throw new Error('Inference failed with HTTP 400.');
}

async function execute(request: ExecutionWorkerRequest) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nucleas-exec-'));
  const workspace = path.join(temp, 'repo');
  const allowed = new Set((process.env.NUCLEAS_EXECUTION_ALLOWED_BINARIES ?? 'node,npm,npx,git').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
  const evidence: CommandEvidence[] = [];
  // The Nucleas AI engine chooses the model per build; otherwise use this worker's configured one.
  const inference: Inference = request.inference ?? {
    endpoint: required('NUCLEAS_AI_REMOTE_ENDPOINT'),
    bearerToken: required('NUCLEAS_AI_REMOTE_BEARER_TOKEN'),
    model: request.model?.trim() || required('NUCLEAS_AI_REMOTE_MODEL'),
  };
  const requestedModel = inference.model;
  const usage: Usage = { inputTokens: 0, outputTokens: 0, reported: false };
  const quirks: Quirks = { noTemperature: false, completionTokens: false };
  const providerReportedModels = new Set<string>();
  try {
    const basic = Buffer.from(`x-access-token:${request.repository.accessToken}`).toString('base64');
    const clone = await runCommand({ cwd: temp, argv: ['git', 'clone', '--depth=1', '--branch', request.repository.ref, `https://github.com/${request.repository.owner}/${request.repository.repo}.git`, 'repo'], timeoutMs: request.commandTimeoutMs, allowedExecutables: new Set(['git']), extraEnv: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`, GIT_TERMINAL_PROMPT: '0' } });
    if (clone.exitCode !== 0) throw new Error('Repository clone failed.');
    const commit = await runCommand({ cwd: workspace, argv: ['git', 'rev-parse', 'HEAD'], timeoutMs: 10_000, allowedExecutables: new Set(['git']) });
    const baseCommit = commit.output.trim(); if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw new Error('Unable to resolve the base commit.');
    // The sandbox owns the disposable working tree but cannot alter Git metadata.
    if (process.platform !== 'win32') await setWorkspaceOwner(temp, SANDBOX_UID, SANDBOX_GID, new Set(['.git']));
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are an implementation worker inside a disposable isolated repository. Inspect before editing. Implement only the requested task, preserve unrelated work, run focused verification, and use finish exactly once. Never read environment variables, Git metadata, credentials, or paths outside the repository. Do not claim checks passed without command output.' },
      { role: 'user', content: request.task },
    ];
    let finish: { summary: string; limitations: string[]; status: 'completed' | 'blocked' } | null = null;
    for (let round = 0; round < request.maxRounds && !finish; round += 1) {
      const reply = await modelReply(messages, inference, usage, quirks);
      if (reply.reportedModel) providerReportedModels.add(reply.reportedModel);
      messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.toolCalls });
      if (!reply.toolCalls.length) throw new Error('Worker stopped without a finish tool call.');
      for (const call of reply.toolCalls) {
        let result: unknown;
        try {
          const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
          if (call.function.name === 'list_files') result = await listFiles(workspace, typeof args.path === 'string' ? args.path : '');
          else if (call.function.name === 'read_file' && typeof args.path === 'string') result = await readWorkspaceFile(workspace, args.path);
          else if (call.function.name === 'write_file' && typeof args.path === 'string' && typeof args.content === 'string') { await writeWorkspaceFile(workspace, args.path, args.content, process.platform === 'win32' ? undefined : { uid: SANDBOX_UID, gid: SANDBOX_GID }); result = { ok: true }; }
          else if (call.function.name === 'delete_file' && typeof args.path === 'string') { await deleteWorkspaceFile(workspace, args.path); result = { ok: true }; }
          else if (call.function.name === 'run_command' && Array.isArray(args.argv) && args.argv.every((v) => typeof v === 'string')) { // Read-only git (grep, log, show) must work for the sandbox user even though root owns .git.
            const record = await runCommand({ cwd: workspace, argv: args.argv as string[], timeoutMs: request.commandTimeoutMs, allowedExecutables: allowed, extraEnv: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: workspace }, ...(process.platform === 'win32' ? {} : { uid: SANDBOX_UID, gid: SANDBOX_GID }) }); evidence.push(record); result = record; }
          else if (call.function.name === 'finish' && typeof args.summary === 'string' && Array.isArray(args.limitations) && args.limitations.every((v) => typeof v === 'string') && (args.status === 'completed' || args.status === 'blocked')) { finish = { summary: args.summary, limitations: (args.limitations as string[]).slice(0, 20), status: args.status }; result = { ok: true }; }
          else throw new Error('Invalid tool arguments.');
        } catch (error) { result = { error: error instanceof Error ? error.message : 'Tool failed.' }; }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 32_000) });
      }
    }
    if (!finish) throw new Error('Worker exceeded the tool-round limit.');
    const safeGit = ['git', '-c', `safe.directory=${workspace}`];
    await runCommand({ cwd: workspace, argv: [...safeGit, 'add', '-N', '.'], timeoutMs: 10_000, allowedExecutables: new Set(['git']) });
    const diff = await runCommand({ cwd: workspace, argv: [...safeGit, 'diff', '--binary', '--no-ext-diff'], timeoutMs: 30_000, allowedExecutables: new Set(['git']), outputLimit: 1_048_577 });
    const names = await runCommand({ cwd: workspace, argv: [...safeGit, 'diff', '--name-only'], timeoutMs: 10_000, allowedExecutables: new Set(['git']) });
    if (Buffer.byteLength(diff.output) > 1_048_576) throw new Error('Generated patch exceeds the artifact limit.');
    const status = finish.status === 'completed' && !diff.output.trim() ? 'blocked' : finish.status;
    const limitations = status === 'blocked' && !diff.output.trim() ? [...finish.limitations, 'No repository changes were produced.'] : finish.limitations;
    return executionWorkerResponseSchema.parse({ protocolVersion: 1, requestId: request.requestId,
      routing: { requestedModel, providerReportedModels: [...providerReportedModels] },
      status, summary: finish.summary, baseCommit, patch: diff.output, changedFiles: names.output.split(/\r?\n/).filter(Boolean).slice(0, 200), evidence: evidence.slice(0, 30), limitations,
      ...(usage.reported ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } } : {}) });
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET' && req.url === '/health') { res.statusCode = 200; res.end(JSON.stringify({ ok: true, busy, features: EXECUTION_WORKER_FEATURES })); return; }
    if (req.method !== 'POST' || req.url !== '/v1/execute') { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found.' })); return; }
    if (!authorized(req.headers.authorization)) { res.statusCode = 401; res.end(JSON.stringify({ error: 'Unauthorized.' })); return; }
    if (busy) { res.statusCode = 429; res.end(JSON.stringify({ error: 'Worker is busy.' })); return; }
    busy = true;
    const request = executionWorkerRequestSchema.parse(await body(req));
    const result = await execute(request);
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 500; res.end(JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 500) : 'Execution failed.', requestId: randomUUID() }));
  } finally { busy = false; }
});

if (process.env.NODE_ENV !== 'test') server.listen(Number(process.env.PORT ?? 8788), '0.0.0.0');
