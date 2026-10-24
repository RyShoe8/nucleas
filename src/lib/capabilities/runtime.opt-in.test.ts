/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory Mongo query fixtures intentionally accept arbitrary document shapes. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { CapabilityDefinition } from './types';

const state = vi.hoisted(() => ({ rows: [] as any[], approvals: [] as any[], connections: [] as any[], manager: true }));
function matches(row: any, filter: any): boolean {
  return Object.entries(filter).every(([key, value]: [string, any]) => {
    if (key === '$or') return value.some((branch: any) => matches(row, branch));
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Types.ObjectId) && !(value instanceof Date)) {
      return Object.entries(value).every(([op, val]: [string, any]) => op === '$ne' ? actual !== val : op === '$exists' ? (actual !== undefined) === val : op === '$gt' ? actual > val : op === '$gte' ? actual >= val : false);
    }
    return value == null ? actual == null : String(actual) === String(value);
  });
}
function query(value: any): any { return { select: () => query(value), sort: () => query(value), lean: async () => value }; }
function model(rows: () => any[]) {
  const update = (filter: any, change: any) => {
    const row = rows().find(r => matches(r, filter));
    if (row) { Object.assign(row, change.$set); for (const key of Object.keys(change.$unset ?? {})) delete row[key]; }
    return row;
  };
  return {
    init: vi.fn(async () => undefined),
    findOne: vi.fn((filter) => query(rows().find(r => matches(r, filter)) ?? null)),
    findById: vi.fn((id) => query(rows().find(r => String(r._id) === String(id)) ?? null)),
    findOneAndUpdate: vi.fn((filter, change) => query(update(filter, change) ?? null)),
    findByIdAndUpdate: vi.fn((id, change) => query(update({ _id: id }, change))),
    updateOne: vi.fn(async (filter, change) => ({ matchedCount: update(filter, change) ? 1 : 0 })),
    create: vi.fn(async (data) => {
      if (data.idempotencyKey && rows().some(r => ['organizationId', 'companyId', 'capabilityId', 'connectionId', 'idempotencyKey'].every(k => String(r[k]) === String(data[k])))) throw Object.assign(new Error('duplicate'), { code: 11000 });
      const row = { _id: new Types.ObjectId(), createdAt: new Date(), status: 'pending', ...data }; rows().push(row); return row;
    }),
  };
}
vi.mock('@/lib/models/Capability', () => ({ CapabilityInvocation: model(() => state.rows), CapabilityApproval: model(() => state.approvals) }));
vi.mock('@/lib/models/Integration', () => ({ IntegrationConnection: model(() => state.connections), ExternalResource: model(() => []) }));
vi.mock('@/lib/integrations/connections', () => ({ readConnectionCredential: vi.fn(async () => 'secret') }));
vi.mock('@/lib/integrations/providers', () => ({ getIntegrationProvider: () => ({ name: 'Provider' }) }));
vi.mock('@/lib/companies/companyProfile', () => ({ getCompanyProfile: async (_viewer: any, id: string) => ({ id, name: 'Company' }), isCompanyManager: () => state.manager }));
vi.mock('./registry', () => ({ CAPABILITIES: [], getCapability: (id: string, registry: CapabilityDefinition[]) => registry.find(d => d.id === id) }));
import { decideApproval, inputDigest, invokeCapability } from './runtime';
import { CapabilityInvocation } from '@/lib/models/Capability';

const initialized = undefined as unknown as Awaited<ReturnType<typeof CapabilityInvocation.init>>;
const org = new Types.ObjectId();
const company = String(new Types.ObjectId());
const connection = new Types.ObjectId();
const viewer = { organizationId: org, userId: String(new Types.ObjectId()), role: 'Administrator' as const, employeeId: null };
let def: CapabilityDefinition;
const call = (input = { value: 'x' }, opts: any = {}) => invokeCapability(viewer, company, def.id, input, { registry: [def], connectionId: String(connection), idempotencyKey: 'key', ...opts });
beforeEach(() => {
  state.rows = []; state.approvals = []; state.manager = true;
  vi.mocked(CapabilityInvocation.init).mockReset().mockResolvedValue(initialized);
  state.connections = [{ _id: connection, organizationId: org, companyId: new Types.ObjectId(company), provider: 'test', status: 'connected', revision: 1, connectorConfig: { enabled: true, destination: 'a' } }];
  def = { id: 'test.write', version: 1, title: 'Test', domain: 'test', kind: 'write', risk: 'low_write', approval: 'auto', provider: 'test', input: z.object({ value: z.string() }), run: vi.fn(async () => ({ output: 'done', summary: 'Done' })) };
});
describe('opt-in capability runtime (mock persistence only)', () => {
  it('preserves legacy digest and context without options', async () => {
    await invokeCapability(viewer, company, def.id, { value: 'x' }, { registry: [def] });
    expect(state.rows[0].inputDigest).toBe(inputDigest(def.id, 1, { value: 'x' }));
    expect(state.rows[0].connectionId).toBeUndefined();
    const ctx = vi.mocked(def.run).mock.calls[0][0];
    expect(ctx.idempotencyKey).toBeUndefined(); expect(ctx.access.configuration).toBeUndefined();
  });
  it('reuses receipts and rejects different payloads', async () => {
    const first = await call(); const second = await call();
    expect(second).toEqual(first); expect(def.run).toHaveBeenCalledTimes(1);
    expect(await call({ value: 'other' })).toMatchObject({ ok: false, status: 409 });
    expect(vi.mocked(def.run).mock.calls[0][0]).toMatchObject({ idempotencyKey: 'key', invocationId: String(state.rows[0]._id), access: { configuration: { destination: 'a' } } });
  });
  it('allows only one concurrent execution', async () => {
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    def.run = vi.fn(async () => { await gate; return { output: 1, summary: 'Done' }; });
    const first = call();
    await vi.waitFor(() => expect(def.run).toHaveBeenCalledTimes(1));
    const second = await call(); expect(second).toMatchObject({ ok: true, invocation: { status: 'running' } });
    release(); await first; expect(def.run).toHaveBeenCalledTimes(1); expect(state.rows).toHaveLength(1);
  });
  it('handles a concurrent unique-index insert race', async () => {
    await Promise.all([call(), call(), call()]); expect(state.rows).toHaveLength(1); expect(def.run).toHaveBeenCalledTimes(1);
  });
  it('does not retry ambiguous nonidempotent writes', async () => {
    def.run = vi.fn(async () => { throw new TypeError('connection lost'); });
    expect(await call()).toMatchObject({ ok: true, invocation: { status: 'uncertain' } });
    await call(); expect(def.run).toHaveBeenCalledTimes(1);
  });
  it('retries uncertain writes only with the adapter guarantee and same key', async () => {
    def.idempotent = true;
    def.run = vi.fn().mockRejectedValueOnce(new TypeError('lost')).mockResolvedValue({ output: 1, summary: 'Done' });
    const first = await call(); const retry = await call();
    expect(first).toMatchObject({ invocation: { status: 'uncertain' } }); expect(retry).toMatchObject({ invocation: { status: 'succeeded' } });
    expect(state.rows).toHaveLength(1); expect(def.run).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('marks stale running leases uncertain; idempotent=%s', async (safe) => {
    await call(); state.rows[0].status = 'running'; state.rows[0].leaseExpiresAt = new Date(0); state.rows[0].leaseToken = 'dead'; def.idempotent = safe;
    expect(await call()).toMatchObject({ invocation: { status: safe ? 'succeeded' : 'uncertain' } });
    expect(def.run).toHaveBeenCalledTimes(safe ? 2 : 1);
  });
  it.each(['companyId', 'organizationId', 'provider'])('rejects explicit connections with wrong %s without fallback', async field => {
    state.connections[0][field] = field === 'provider' ? 'other' : new Types.ObjectId();
    expect(await call()).toMatchObject({ ok: false, status: 409 }); expect(def.run).not.toHaveBeenCalled();
  });
  it('enforces configuration disabled only on opt-in', async () => {
    state.connections[0].connectorConfig.enabled = false;
    expect(await call()).toMatchObject({ ok: false, status: 409 });
    await invokeCapability(viewer, company, def.id, { value: 'x' }, { registry: [def] }); expect(def.run).toHaveBeenCalledTimes(1);
  });
  it('cancels stale destination approvals and never switches connections', async () => {
    def.approval = 'required'; await call(); state.connections[0].revision++;
    const result = await decideApproval(viewer, String(state.approvals[0]._id), 'approve', { registry: [def] });
    expect(result).toMatchObject({ invocation: { status: 'cancelled' } }); expect(def.run).not.toHaveBeenCalled();
  });
  it('reuses the exact pending and approved keyed invocation', async () => {
    def.approval = 'required'; const pending = await call(); expect(await call()).toEqual(pending); expect(state.approvals).toHaveLength(1);
    const approved = await decideApproval(viewer, String(state.approvals[0]._id), 'approve', { registry: [def] });
    expect(approved).toMatchObject({ invocation: { status: 'succeeded' } }); expect(await call()).toEqual(approved); expect(def.run).toHaveBeenCalledTimes(1);
  });
  it('retains manager authorization on writes and approvals', async () => {
    state.manager = false; expect(await call()).toMatchObject({ ok: false, status: 403 });
    expect(await decideApproval(viewer, String(new Types.ObjectId()), 'approve')).toMatchObject({ ok: false, status: 403 });
  });
  it('separates read cache entries by connection revision', async () => {
    def.kind = 'read'; def.cacheSeconds = 60;
    await call({ value: 'x' }, { idempotencyKey: undefined });
    await call({ value: 'x' }, { idempotencyKey: undefined }); expect(def.run).toHaveBeenCalledTimes(1);
    state.connections[0].revision++;
    await call({ value: 'x' }, { idempotencyKey: undefined }); expect(def.run).toHaveBeenCalledTimes(2);
  });
  it('cancels approval when the registry provider changes', async () => {
    def.approval = 'required'; await call(); def.provider = 'other';
    expect(await decideApproval(viewer, String(state.approvals[0]._id), 'approve', { registry: [def] })).toMatchObject({ invocation: { status: 'cancelled' } });
    expect(def.run).not.toHaveBeenCalled();
  });
  it('cancels approval when the exact connection is no longer accessible', async () => {
    def.approval = 'required'; await call(); state.connections[0].companyId = new Types.ObjectId();
    expect(await decideApproval(viewer, String(state.approvals[0]._id), 'approve', { registry: [def] })).toMatchObject({ invocation: { status: 'cancelled' } });
    expect(def.run).not.toHaveBeenCalled();
  });
  it('fences a late worker after a stale lease becomes uncertain', async () => {
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    def.run = vi.fn(async () => { await gate; return { output: 1, summary: 'Done' }; });
    const first = call(); await vi.waitFor(() => expect(def.run).toHaveBeenCalledTimes(1));
    state.rows[0].leaseExpiresAt = new Date(0);
    expect(await call()).toMatchObject({ invocation: { status: 'uncertain' } });
    release(); expect(await first).toMatchObject({ invocation: { status: 'uncertain' } });
  });
  it('rejects missing approval when a retry now requires one', async () => {
    def.idempotent = true; def.run = vi.fn(async () => { throw new TypeError('lost'); });
    await call(); def.approval = 'required';
    expect(await call()).toMatchObject({ ok: false, status: 409 }); expect(def.run).toHaveBeenCalledTimes(1);
  });

  it('preserves the legacy required approval flow without connector options', async () => {
    def.approval = 'required';
    const pending = await invokeCapability(viewer, company, def.id, { value: 'x' }, { registry: [def] });
    expect(pending).toMatchObject({ invocation: { status: 'pending_approval' } });
    expect(state.approvals[0].inputDigest).toBe(inputDigest(def.id, def.version, { value: 'x' }));
    expect(await decideApproval(viewer, String(state.approvals[0]._id), 'approve', { registry: [def] })).toMatchObject({ invocation: { status: 'succeeded' } });
    expect(def.run).toHaveBeenCalledTimes(1);
  });
  it('preserves legacy unexpected error status without connector options', async () => {
    def.run = vi.fn(async () => { throw new TypeError('lost'); });
    expect(await invokeCapability(viewer, company, def.id, { value: 'x' }, { registry: [def] })).toMatchObject({ invocation: { status: 'failed' } });
  });
  it('rejects a keyed read and malformed explicit ID', async () => {
    def.kind = 'read'; expect(await call()).toMatchObject({ ok: false, status: 400 });
    expect(await call({ value: 'x' }, { connectionId: 'invalid', idempotencyKey: undefined })).toMatchObject({ ok: false, status: 400 });
    expect(state.rows).toHaveLength(0);
  });

  it.each([undefined, String(connection)])('supports keyed shared-org connections with selection %s', async connectionId => {
    state.connections[0].companyId = null; state.connections[0].scope = 'org';
    const first = await call({ value: 'x' }, { connectionId });
    expect(first).toMatchObject({ ok: true, invocation: { status: 'succeeded' } });
    expect(await call({ value: 'x' }, { connectionId })).toEqual(first);
    expect(String(state.rows[0].connectionId)).toBe(String(connection)); expect(def.run).toHaveBeenCalledTimes(1);
  });
  it('rejects a null-company connection that is not org-scoped', async () => {
    state.connections[0].companyId = null; state.connections[0].scope = 'company';
    expect(await call()).toMatchObject({ ok: false, status: 409 }); expect(def.run).not.toHaveBeenCalled();
  });
  it('awaits index initialization before keyed receipts or execution', async () => {
    let release!: () => void;
    vi.mocked(CapabilityInvocation.init).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(initialized); }));
    const pending = call(); await vi.waitFor(() => expect(CapabilityInvocation.init).toHaveBeenCalledTimes(1));
    expect(state.rows).toHaveLength(0); expect(def.run).not.toHaveBeenCalled();
    release(); expect(await pending).toMatchObject({ invocation: { status: 'succeeded' } });
  });
  it('fails closed if unique index initialization fails', async () => {
    vi.mocked(CapabilityInvocation.init).mockRejectedValueOnce(new Error('index unavailable'));
    await expect(call()).rejects.toThrow('index unavailable'); expect(state.rows).toHaveLength(0); expect(def.run).not.toHaveBeenCalled();
  });
  it('does not initialize indexes on the legacy or unkeyed opt-in paths', async () => {
    await call({ value: 'x' }, { connectionId: undefined, idempotencyKey: undefined });
    await call({ value: 'x' }, { idempotencyKey: undefined });
    expect(CapabilityInvocation.init).not.toHaveBeenCalled();
  });
  it('preserves explicit output above 200K within the configured limit', async () => {
    def.maxOutputBytes = 2_000_000; const output = 'a'.repeat(250_000);
    def.run = vi.fn(async () => ({ output, summary: 'Large listing' }));
    expect(await call()).toMatchObject({ invocation: { status: 'succeeded', output } });
  });
  it('clearly fails explicit overflow using UTF-8 bytes', async () => {
    def.maxOutputBytes = 210_000;
    def.run = vi.fn(async () => ({ output: 'é'.repeat(110_000), summary: 'Listing' }));
    expect(await call()).toMatchObject({ invocation: { status: 'failed', output: null, error: 'Provider output exceeds the configured limit of 210000 bytes.' } });
  });
  it('clamps an explicit limit to two million bytes', async () => {
    def.maxOutputBytes = 3_000_000;
    def.run = vi.fn(async () => ({ output: 'a'.repeat(2_000_000), summary: 'Listing' }));
    expect(await call()).toMatchObject({ invocation: { status: 'failed', output: null, error: 'Provider output exceeds the configured limit of 2000000 bytes.' } });
  });
  it('keeps default oversized output behavior unchanged', async () => {
    def.run = vi.fn(async () => ({ output: 'a'.repeat(250_000), summary: 'Listing' }));
    expect(await call()).toMatchObject({ invocation: { status: 'succeeded', output: null } });
  });

});
