import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { GatewayError } from '@nucleas/ai-core/gateway';

vi.mock('server-only', () => ({}));
const listed = vi.hoisted(() => ({ models: [] as { profileId: string; model: string; free: boolean; benched?: unknown }[] }));
vi.mock('./catalog', () => ({ listAvailableModels: async () => listed.models }));
vi.mock('@/lib/ai/rolePipeline/profiles', () => ({ gatewayFromModelProfile: async () => ({ gateway: {} }) }));

import { AiDispatchLock } from '@/lib/models/AiControl';
import { AiModelCheck, modelCheckRows } from './checkResults';
import { checkModel, queueModelChecks, runQueuedModelChecks, type CheckCaller } from './modelChecks';
import { applyEdits, EDIT_CASES, ROUTING_CASES } from './checkCases';

let replica: MongoMemoryReplSet;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_model_checks_test'));
  await AiModelCheck.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([AiModelCheck.deleteMany({}), AiDispatchLock.deleteMany({})]);
});

const refused = () => new GatewayError('unavailable', { kind: 'http', httpStatus: 400 });

/** A model that gets everything right (an answer key for checkCases); options make its host refuse features. */
function fakeModel(options: { schema?: boolean; tools?: boolean; routeAll?: string; nativeTools?: 'ignored' } = {}): CheckCaller & { formats: string[] } {
  const formats: string[] = [];
  const reply = (text: string) => ({ text, latencyMs: 100 });
  return {
    formats,
    async plain(messages, format) {
      formats.push(format?.type ?? 'none');
      if (format?.type === 'json_schema' && options.schema === false) throw refused();
      const system = messages[0].content;
      const user = messages[messages.length - 1].content;
      if (system.startsWith('Extract facts')) return reply('{"city":"Springfield","population":167882}');
      if (system.startsWith('You sort requests')) {
        const item = ROUTING_CASES.find((c) => user.endsWith(`Latest message:\n${c.text}`))!;
        return reply(JSON.stringify({ route: options.routeAll ?? item.route, company: item.company ?? 'none', request: item.text }));
      }
      if (system.startsWith('You edit code')) {
        if (/Remove the OpenHV/.test(user)) return reply(JSON.stringify({ edits: [{ find: "  { id: 'openhv', name: 'OpenHV', parent: 'openra' },\n", replace: '' }] }));
        if (/Rename/.test(user)) return reply(JSON.stringify({ edits: [{ find: 'function formatPrice(', replace: 'function formatUsd(' }, { find: '${formatPrice(', replace: '${formatUsd(' }] }));
        return reply(
          JSON.stringify({ edits: [{ find: '  return `${item.name}: ${formatPrice(item.priceCents)}`;', replace: '  return item.priceCents === 0 ? `${item.name}: Free` : `${item.name}: ${formatPrice(item.priceCents)}`;' }] })
        );
      }
      const answers: [RegExp, string][] = [
        [/2\.2 and 2\.3 combined/, '69 games were added.'],
        [/OpenHV/, 'Version 2.3 moved it under OpenRA.'],
        [/Minecraft/, 'No, its servers are listed in a separate directory.'],
        [/2\.4 add/, 'None; no new games are planned for 2.4.'],
        [/logo/, 'The notes do not say.'],
        [/before version 2\.2/, '1,135 games.'],
      ];
      return reply(answers.find(([re]) => re.test(user))?.[1] ?? 'The notes do not say.');
    },
    async tools(messages, _tools, mode) {
      if (options.tools === false) throw refused();
      if (options.nativeTools === 'ignored' && mode === 'native') return { text: 'Playbound.club had many visitors.', toolCalls: [], latencyMs: 200 };
      const last = messages[messages.length - 1];
      const user = String(messages[1].content);
      const call = (name: string, args: Record<string, unknown>) => ({ text: '', toolCalls: [{ name, arguments: JSON.stringify(args) }], latencyMs: 300 });
      if (last.role === 'tool') return call('repo_read', { company: 'Playbound.club', path: 'src/data/gameServers.ts' });
      if (/14 days/.test(user)) return call('company_metrics', { company: 'Playbound.club', metric: 'visitors', days: 14 });
      if (/What changed/.test(user)) return call('company_activity', { company: 'Frugal Gambler' });
      if (/Where in the PlayBound code/.test(user)) return call('repo_search', { company: 'Playbound.club', query: 'OpenHV' });
      if (/revenue/.test(user)) return call('company_metrics', { company: 'Frugal Gambler', metric: 'revenue', days: 30 });
      return { text: "You're welcome.", toolCalls: [], latencyMs: 300 };
    },
  };
}

describe('free model checks', () => {
  it('scores a capable model on every check and uses schema-guided JSON', async () => {
    const caller = fakeModel();
    const outcome = await checkModel(caller);
    expect(outcome).toMatchObject({ jsonMode: 'json_schema', supports: { jsonSchema: true, jsonObject: true, tools: true }, scores: { json: 1, routing: 1, tools: 1, grounded: 1, code: 1 }, overall: 1 });
    // Extraction, 12 routing cases and 3 code edits all use schema-guided JSON.
    expect(caller.formats.filter((f) => f === 'json_schema')).toHaveLength(16);
  });

  it('falls back when the host refuses features, and records what went wrong', async () => {
    const caller = fakeModel({ schema: false, tools: false, routeAll: 'answer' });
    const outcome = await checkModel(caller);
    expect(outcome.jsonMode).toBe('json_object');
    expect(outcome.supports).toEqual({ jsonSchema: false, jsonObject: true, tools: false });
    expect(outcome.scores).toMatchObject({ json: 1, routing: 0.33, tools: 0, grounded: 1, code: 1 });
    expect(outcome.notes).toContain('Host refused response_format json_schema.');
    expect(outcome.notes).toContain('native: host refused tool calls.');
    expect(outcome.notes.some((n) => n.includes('expected code_change / Playbound.club'))).toBe(true);
  });

  it('queues the free models, runs them under the shared lock, and keeps failures visible', async () => {
    const [p1, p2] = [String(new Types.ObjectId()), String(new Types.ObjectId())];
    listed.models = [
      { profileId: p1, model: 'google/gemma-4-12B', free: true },
      { profileId: p1, model: 'Qwen/Qwen2.5-Coder-14B', free: true },
      { profileId: p2, model: 'gpt-6-sol', free: false },
    ];
    expect(await queueModelChecks()).toBe(2);

    let lockHeldDuringCheck = false;
    const result = await runQueuedModelChecks({
      caller: async (_profileId, model) => {
        if (model.startsWith('Qwen')) throw new GatewayError('unavailable', { kind: 'http', httpStatus: 503, providerMessage: 'Model loading' });
        lockHeldDuringCheck = Boolean(await AiDispatchLock.exists({ expiresAt: { $gt: new Date() } }));
        return fakeModel();
      },
    });
    expect(result.checked).toBe(1);
    expect(lockHeldDuringCheck).toBe(true);
    expect(await AiDispatchLock.countDocuments()).toBe(0);

    const rows = await modelCheckRows();
    expect(rows.find((r) => r.model.startsWith('google'))).toMatchObject({ status: 'done', overall: 1, supports: { tools: true } });
    expect(rows.find((r) => r.model.startsWith('Qwen'))).toMatchObject({ status: 'failed', error: 'unavailable (503): Model loading', checkedAt: null });

    // Re-queuing keeps the earlier scores in use until new ones land.
    await queueModelChecks();
    expect((await modelCheckRows()).find((r) => r.model.startsWith('google'))).toMatchObject({ status: 'queued', overall: 1 });
  });
});

describe('tool modes', () => {
  it('uses tools described in the prompt when the host ignores native tools, and says what the model replied', async () => {
    const outcome = await checkModel(fakeModel({ nativeTools: 'ignored' }));
    expect(outcome).toMatchObject({ toolMode: 'prompted', supports: { tools: true }, scores: { tools: 1 } });
    // Only the winning mode's notes are kept, and prompted mode got everything right.
    expect(outcome.notes).toEqual([]);
    expect((await checkModel(fakeModel())).toolMode).toBe('native');
  });
});

describe('code edit scoring', () => {
  it('applies only exact, unique finds and rejects wrong results', () => {
    const [removeCase] = EDIT_CASES;
    expect(applyEdits('a a', [{ find: 'a', replace: 'b' }])).toBeNull();
    expect(applyEdits('abc', [{ find: 'x', replace: 'y' }])).toBeNull();
    expect(applyEdits('abc', [])).toBeNull();
    // Removing the wrong OpenHV line fails.
    const wrong = applyEdits(removeCase.file, [{ find: "  { id: 'openhv', name: 'OpenHV', parent: null },\n", replace: '' }]);
    expect(wrong && removeCase.pass(wrong)).toBe(false);
  });
});
