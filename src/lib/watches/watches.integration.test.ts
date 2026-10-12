import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
const company = vi.hoisted(() => ({ id: 'c'.repeat(24) }));
vi.mock('@/lib/companies/companyProfile', () => ({
  isCompanyManager: (v: { role: string }) => v.role === 'Administrator' || v.role === 'Manager',
  getCompanyProfile: async (_viewer: unknown, id: string) => (id === company.id ? { id, name: 'PlayBound' } : null),
  listCompanyProfiles: async () => [{ id: company.id, name: 'PlayBound' }],
}));

import { ContentWatch, WatchItem, WatchMailbox, WatchPost } from '@/lib/models/Watch';
import { createWatch, deleteWatch, getItemDetail, listItems, listWatches, updateWatch } from './watches';
import { listMailboxes, removeMailbox } from './mailboxes';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const viewer = (over: Partial<{ organizationId: Types.ObjectId; role: 'Administrator' | 'Manager' | 'User' }> = {}) => ({ userId: String(new Types.ObjectId()), organizationId: over.organizationId ?? org, employeeId: null, role: over.role ?? 'Manager' as const });

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_watch_crud_test'));
  await Promise.all([ContentWatch.syncIndexes(), WatchItem.syncIndexes(), WatchMailbox.syncIndexes(), WatchPost.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

let mailboxId: string;
beforeEach(async () => {
  await Promise.all([ContentWatch.deleteMany({}), WatchItem.deleteMany({}), WatchMailbox.deleteMany({}), WatchPost.deleteMany({})]);
  mailboxId = String((await WatchMailbox.create({ organizationId: org, emailAddress: 'me@example.org', refreshTokenSealed: 'sealed', status: 'connected' }))._id);
});

const valid = () => ({ name: 'Launches', mailboxId, description: 'New product launches', threshold: 70 });

describe('creating and listing watches', () => {
  it('creates a watch with sensible defaults and lists it with its mailbox', async () => {
    const created = await createWatch(viewer(), valid());
    expect(created).toMatchObject({ ok: true, data: { name: 'Launches', mode: 'match', threshold: 70, lookbackHours: 168, intervalMinutes: 60, aiSummary: true, active: true, mailboxEmail: 'me@example.org', companyId: null } });
    expect(await listWatches(viewer())).toHaveLength(1);
  });

  it('is for managers and administrators only', async () => {
    expect(await createWatch(viewer({ role: 'User' }), valid())).toMatchObject({ ok: false, status: 403 });
    expect(await listWatches(viewer({ role: 'User' }))).toBeNull();
  });

  it('keeps organizations apart', async () => {
    const created = await createWatch(viewer(), valid());
    const other = viewer({ organizationId: new Types.ObjectId() });
    expect(await listWatches(other)).toEqual([]);
    expect(await createWatch(other, valid())).toMatchObject({ ok: false, status: 404, error: 'That mailbox is not connected.' });
    if (!created.ok) throw new Error('setup');
    expect(await updateWatch(other, created.data.id, { name: 'Hijacked' })).toMatchObject({ ok: false, status: 404 });
    expect(await deleteWatch(other, created.data.id)).toMatchObject({ ok: false, status: 404 });
  });

  it('asks for something to look for, and rejects out-of-range settings', async () => {
    expect(await createWatch(viewer(), { name: 'Empty', mailboxId })).toMatchObject({ ok: false, status: 400, error: 'Describe what to look for, or add at least one keyword.' });
    expect(await createWatch(viewer(), { ...valid(), threshold: 150 })).toMatchObject({ ok: false, status: 400 });
    expect(await createWatch(viewer(), { ...valid(), intervalMinutes: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(await createWatch(viewer(), { ...valid(), surprise: true })).toMatchObject({ ok: false, status: 400 });
    // A deal watch needs no description: the deal is the thing it looks for.
    expect(await createWatch(viewer(), { name: 'Deals', mailboxId, mode: 'deal', threshold: 25, dealUnitTokens: ['SC', 'GC'] })).toMatchObject({ ok: true });
  });

  it('only attaches a company the viewer can see', async () => {
    expect(await createWatch(viewer(), { ...valid(), companyId: new Types.ObjectId().toHexString() })).toMatchObject({ ok: false, status: 404, error: 'Company not found.' });
    expect(await createWatch(viewer(), { ...valid(), companyId: company.id })).toMatchObject({ ok: true, data: { companyId: company.id, companyName: 'PlayBound' } });
  });
});

describe('changing and deleting', () => {
  it('overlays changes on the stored settings and re-validates the whole watch', async () => {
    const created = await createWatch(viewer(), valid());
    if (!created.ok) throw new Error('setup');
    const updated = await updateWatch(viewer(), created.data.id, { threshold: 85, keywords: ['launch'], active: false });
    expect(updated).toMatchObject({ ok: true, data: { threshold: 85, keywords: ['launch'], active: false, description: 'New product launches', name: 'Launches' } });
    expect(await updateWatch(viewer(), created.data.id, { description: '', keywords: [] })).toMatchObject({ ok: false, status: 400 });
    expect(await updateWatch(viewer(), created.data.id, { companyId: company.id })).toMatchObject({ ok: true, data: { companyId: company.id } });
    expect(await updateWatch(viewer(), created.data.id, { companyId: null })).toMatchObject({ ok: true, data: { companyId: null } });
  });

  it('deleting a watch removes its emails and posts', async () => {
    const created = await createWatch(viewer(), valid());
    if (!created.ok) throw new Error('setup');
    const watchId = new Types.ObjectId(created.data.id);
    const item = await WatchItem.create({ organizationId: org, watchId, mailboxId: new Types.ObjectId(mailboxId), gmailId: 'g1' });
    await WatchPost.create({ organizationId: org, watchId, itemId: item._id, dealKey: 'content-only' });
    expect(await deleteWatch(viewer(), created.data.id)).toMatchObject({ ok: true });
    expect(await WatchItem.countDocuments({ watchId })).toBe(0);
    expect(await WatchPost.countDocuments({ watchId })).toBe(0);
  });
});

describe('reading scanned emails', () => {
  it('lists flagged emails by default, newest first, and everything on request', async () => {
    const created = await createWatch(viewer(), valid());
    if (!created.ok) throw new Error('setup');
    const watchId = new Types.ObjectId(created.data.id);
    const base = { organizationId: org, watchId, mailboxId: new Types.ObjectId(mailboxId) };
    await WatchItem.create([
      { ...base, gmailId: 'a', subject: 'Old hit', sentAt: new Date('2026-10-01'), flagged: true, score: 90, text: 'secret body', htmlPreview: '<p>x</p>' },
      { ...base, gmailId: 'b', subject: 'New hit', sentAt: new Date('2026-10-05'), flagged: true, score: 75 },
      { ...base, gmailId: 'c', subject: 'Miss', sentAt: new Date('2026-10-06'), flagged: false, score: 10 },
      { ...base, gmailId: 'd', subject: 'Skipped', sentAt: new Date('2026-10-07'), skipReason: 'keyword_no_match' },
    ]);
    const flagged = await listItems(viewer(), created.data.id);
    expect(flagged).toMatchObject({ ok: true });
    if (!flagged.ok) throw new Error('x');
    expect(flagged.data.items.map((i) => i.subject)).toEqual(['New hit', 'Old hit']);
    // The list never carries the full text or HTML.
    expect(JSON.stringify(flagged.data.items)).not.toContain('secret body');
    const scored = await listItems(viewer(), created.data.id, { filter: 'scored' });
    if (!scored.ok) throw new Error('x');
    expect(scored.data.items.map((i) => i.subject)).toEqual(['Miss', 'New hit', 'Old hit']);
    const all = await listItems(viewer(), created.data.id, { filter: 'all', limit: 2 });
    if (!all.ok) throw new Error('x');
    expect(all.data).toMatchObject({ hasMore: true });
    expect(all.data.items.map((i) => i.subject)).toEqual(['Skipped', 'Miss']);
    expect(await listItems(viewer({ organizationId: new Types.ObjectId() }), created.data.id)).toMatchObject({ ok: false, status: 404 });
  });

  it('returns one email in full only to its organization', async () => {
    const created = await createWatch(viewer(), valid());
    if (!created.ok) throw new Error('setup');
    const item = await WatchItem.create({ organizationId: org, watchId: new Types.ObjectId(created.data.id), mailboxId: new Types.ObjectId(mailboxId), gmailId: 'g', subject: 'Hello', text: 'Full text', htmlPreview: '<p>Hello</p>', flagged: true });
    expect(await getItemDetail(viewer(), String(item._id))).toMatchObject({ ok: true, data: { text: 'Full text', html: '<p>Hello</p>', item: { subject: 'Hello' } } });
    expect(await getItemDetail(viewer({ organizationId: new Types.ObjectId() }), String(item._id))).toMatchObject({ ok: false, status: 404 });
  });
});

describe('mailboxes', () => {
  it('lists them without secrets and refuses to remove one a watch still uses', async () => {
    const created = await createWatch(viewer(), valid());
    if (!created.ok) throw new Error('setup');
    const list = await listMailboxes(viewer());
    expect(list).toEqual([{ id: mailboxId, emailAddress: 'me@example.org', status: 'connected', lastError: null, watchCount: 1 }]);
    expect(JSON.stringify(list)).not.toContain('sealed');
    expect(await removeMailbox(viewer(), mailboxId)).toMatchObject({ ok: false, status: 409 });
    await deleteWatch(viewer(), created.data.id);
    expect(await removeMailbox(viewer({ organizationId: new Types.ObjectId() }), mailboxId)).toMatchObject({ ok: false, status: 404 });
    expect(await removeMailbox(viewer(), mailboxId)).toEqual({ ok: true });
    expect(await WatchMailbox.countDocuments()).toBe(0);
  });
});
