import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { BusinessEvent } from '@/lib/models/BusinessEvent';
import { MetricSnapshot, MetricSyncState } from '@/lib/models/Metric';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { receiveCompanyEvent, setUpCompanyEvents, signPayload } from './companyEvents';
import { syncCompanyMetrics } from '@/lib/metrics/sync';

let replica: MongoMemoryReplSet;
const orgId = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: null, role: 'Administrator' };
const member: CompanyViewer = { ...admin, role: 'User', employeeId: String(new Types.ObjectId()) };
const NOW = new Date('2026-09-28T15:00:00Z');
let companyId: Types.ObjectId;
let connectionId: string;

beforeAll(async () => {
  vi.stubEnv('NUCLEAS_SECRETS_KEY', 'events-test-key');
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_events_test'));
  await Promise.all([BusinessEvent.syncIndexes(), MetricSnapshot.syncIndexes(), IntegrationConnection.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([Client.deleteMany({}), Project.deleteMany({}), IntegrationConnection.deleteMany({}), IntegrationSecret.deleteMany({}), BusinessEvent.deleteMany({}), MetricSnapshot.deleteMany({}), MetricSyncState.deleteMany({})]);
  const hub = await Project.create({ name: 'Tailnote', projectType: 'internal', category: 'website', status: 'launched', color: '#111', userId: new Types.ObjectId() });
  const company = await Client.create({ organizationId: orgId, name: 'Tailnote', color: '#111', relationship: 'owned', domain: 'tailnote.io', hubProjectId: hub._id });
  companyId = company._id as Types.ObjectId;
  const conn = await IntegrationConnection.create({ organizationId: orgId, companyId, provider: 'signups', scope: 'company', status: 'declared', source: 'manual' });
  connectionId = String(conn._id);
});

function send(secret: string, body: object, ts = String(Math.floor(NOW.getTime() / 1000)), tamper = false) {
  const raw = JSON.stringify(body);
  const signature = signPayload(secret, ts, raw);
  return receiveCompanyEvent(connectionId, { timestamp: ts, signature: tamper ? signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0') : signature }, raw, NOW);
}

describe('company signup events', () => {
  it('setup is manager-only, returns the secret once and stores it encrypted', async () => {
    expect(await setUpCompanyEvents(member, connectionId, 'https://os.nucleas.app')).toMatchObject({ ok: false, status: 403 });
    const res = await setUpCompanyEvents(admin, connectionId, 'https://os.nucleas.app/');
    expect(res).toMatchObject({ ok: true, url: `https://os.nucleas.app/api/webhooks/company-events/${connectionId}` });
    const secret = res.ok ? res.secret : '';
    const stored = await IntegrationSecret.findOne().select('+sealed').lean();
    expect(stored?.sealed).not.toContain(secret);
    expect((await IntegrationConnection.findById(connectionId).lean())?.status).toBe('connected');
  });

  it('accepts signed events, stores only a hash, and ignores duplicate deliveries', async () => {
    const setup = await setUpCompanyEvents(admin, connectionId, 'https://os.nucleas.app');
    const secret = setup.ok ? setup.secret : '';
    expect((await send(secret, { type: 'user.signed_up', userId: 'user-42@example.com' })).status).toBe(202);
    expect(await send(secret, { type: 'user.signed_up', userId: 'user-42@example.com' })).toMatchObject({ status: 200, body: { duplicate: true } });
    const events = await BusinessEvent.find().lean();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('user-42');
  });

  it('rejects bad signatures, stale timestamps, unknown types and unknown endpoints', async () => {
    const setup = await setUpCompanyEvents(admin, connectionId, 'https://os.nucleas.app');
    const secret = setup.ok ? setup.secret : '';
    expect((await send(secret, { type: 'user.signed_up', userId: 'a' }, undefined, true)).status).toBe(401);
    expect((await send('wrong-secret', { type: 'user.signed_up', userId: 'a' })).status).toBe(401);
    expect((await send(secret, { type: 'user.signed_up', userId: 'a' }, String(Math.floor(NOW.getTime() / 1000) - 3600))).status).toBe(401);
    expect((await send(secret, { type: 'user.deleted', userId: 'a' })).status).toBe(400);
    expect((await receiveCompanyEvent(String(new Types.ObjectId()), { timestamp: '1', signature: 'x' }, '{}', NOW)).status).toBe(404);
    expect(await BusinessEvent.countDocuments()).toBe(0);
  });

  it('rotating the secret invalidates the old one', async () => {
    const first = await setUpCompanyEvents(admin, connectionId, 'https://os.nucleas.app');
    const second = await setUpCompanyEvents(admin, connectionId, 'https://os.nucleas.app');
    expect((await send(first.ok ? first.secret : '', { type: 'user.signed_up', userId: 'a' })).status).toBe(401);
    expect((await send(second.ok ? second.secret : '', { type: 'user.signed_up', userId: 'a' })).status).toBe(202);
    expect(await IntegrationSecret.countDocuments()).toBe(1);
  });

  it('the metric sync turns events into daily new-user counts', async () => {
    const setup = await setUpCompanyEvents(admin, connectionId, 'https://os.nucleas.app');
    const secret = setup.ok ? setup.secret : '';
    await send(secret, { type: 'user.signed_up', userId: 'a', occurredAt: '2026-09-26T10:00:00Z' });
    await send(secret, { type: 'user.signed_up', userId: 'b', occurredAt: '2026-09-26T22:00:00Z' });
    await send(secret, { type: 'user.signed_up', userId: 'c', occurredAt: '2026-09-27T08:00:00Z' });
    await syncCompanyMetrics(orgId, companyId, { days: 7, now: NOW });
    const rows = await MetricSnapshot.find({ companyId, metricKey: 'users_new' }).sort({ date: 1 }).lean();
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.date === '2026-09-26')?.value).toBe(2);
    expect(rows.find((r) => r.date === '2026-09-27')?.value).toBe(1);
  });
});
