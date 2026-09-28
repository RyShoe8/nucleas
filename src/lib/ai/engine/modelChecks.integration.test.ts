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

/** A model that gets everything right; options make its host refuse features. */
function fakeModel(options: { schema?: boolean; tools?: boolean; routeAll?: string; nativeTools?: 'ignored' } = {}): CheckCaller & { formats: string[] } {
  const formats: string[] = [];
  return {
    formats,
    async plain(messages, format) {
      formats.push(format?.type ?? 'none');
      if (format?.type === 'json_schema' && options.schema === false) throw refused();
      const system = messages[0].content;
      const user = messages[messages.length - 1].content;
      if (system.startsWith('Extract facts')) return { text: '{"city":"Springfield","population":167882}', latencyMs: 100 };
      if (system.startsWith('You sort requests')) {
        const route = options.routeAll ?? (/every day|research/i.test(user) ? 'job' : /remove|fix/i.test(user) ? 'code_change' : 'answer');
        return { text: `{"route":"${route}"}`, latencyMs: 100 };
      }
      if (/how many games/i.test(user)) return { text: 'The catalog holds 1,204 games.', latencyMs: 100 };
      if (/when did/i.test(user)) return { text: 'It shipped on 14 August 2026.', latencyMs: 100 };
      return { text: 'The notes do not say who designed the logo.', latencyMs: 100 };
    },
    async tools(messages, _tools, mode) {
      if (options.tools === false) throw refused();
      if (options.nativeTools === 'ignored' && mode === 'native') return { text: 'Playbound.club had many visitors.', toolCalls: [], latencyMs: 200 };
      const user = messages[messages.length - 1].content;
      return /visitors/.test(user)
        ? { text: '', toolCalls: [{ name: 'company_metrics', arguments: '{"company":"Playbound.club","metric":"visitors","days":7}' }], latencyMs: 300 }
        : { text: '', toolCalls: [{ name: 'repo_search', arguments: '{"company":"PlayBound","query":"OpenHV"}' }], latencyMs: 300 };
    },
  };
}

describe('free model checks', () => {
  it('scores a capable model on every check and uses schema-guided JSON', async () => {
    const caller = fakeModel();
    const outcome = await checkModel(caller);
    expect(outcome).toMatchObject({ jsonMode: 'json_schema', supports: { jsonSchema: true, jsonObject: true, tools: true }, scores: { json: 1, routing: 1, tools: 1, grounded: 1 }, overall: 1 });
    expect(caller.formats.filter((f) => f === 'json_schema')).toHaveLength(7);
  });

  it('falls back when the host refuses features, and records what went wrong', async () => {
    const caller = fakeModel({ schema: false, tools: false, routeAll: 'answer' });
    const outcome = await checkModel(caller);
    expect(outcome.jsonMode).toBe('json_object');
    expect(outcome.supports).toEqual({ jsonSchema: false, jsonObject: true, tools: false });
    expect(outcome.scores).toMatchObject({ json: 1, routing: 0.33, tools: 0, grounded: 1 });
    expect(outcome.notes).toContain('Host refused response_format json_schema.');
    expect(outcome.notes).toContain('native: host refused tool calls.');
    expect(outcome.notes.some((n) => n.includes('expected code_change'))).toBe(true);
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
    expect(outcome.notes).toContain('native: no tool call for "How many visitors did Playbound.club hav…"; replied: Playbound.club had many visitors.');
    expect((await checkModel(fakeModel())).toolMode).toBe('native');
  });
});
