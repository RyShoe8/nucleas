import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/services/email', () => ({ sendEmail: vi.fn() }));
vi.mock('./scanAi', () => ({ analyzeEmail: vi.fn() }));

import { ContentWatch, WatchMailbox } from '@/lib/models/Watch';
import { Job } from '@/lib/models/Job';
import User from '@/lib/models/User';
import { sealSecret } from '@/lib/security/secretBox';
import { GmailAccessTokenRejected, GmailAuthError, type GmailApi } from '@/lib/mail/gmailClient';
import { checkMailboxConnections, disconnectMessage, markMailboxDisconnected, reconnectLink, watchMailboxPurpose } from './mailboxHealth';
import { scanWatch } from './runWatch';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const DAY = 86_400_000;
const EMAIL = 'deals@example.org';

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-mailbox-health';
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_mailbox_health_test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

const person = (name: string, email: string, organizationId = org) => User.collection.insertOne({ name, email, organizationId: String(organizationId) }).then((r) => r.insertedId as Types.ObjectId);
const mailbox = (over: Record<string, unknown> = {}) => WatchMailbox.create({ organizationId: org, emailAddress: EMAIL, refreshTokenSealed: sealSecret(watchMailboxPurpose(EMAIL), 'refresh-token'), status: 'connected', ...over });

beforeEach(async () => {
  await Promise.all([WatchMailbox.deleteMany({}), ContentWatch.deleteMany({}), Job.deleteMany({}), User.collection.deleteMany({})]);
});

/** A mailbox with a watch made by one person and a job on that watch made by another. */
async function scanner() {
  const jobCreator = await person('Jo Creator', 'jo@example.org');
  const watchCreator = await person('Wes Watcher', 'wes@example.org');
  const box = await mailbox();
  const watch = await ContentWatch.create({ organizationId: org, createdByUserId: watchCreator, mailboxId: box._id, name: 'Casino deals', description: 'deals' });
  await Job.create({ organizationId: org, companyId: new Types.ObjectId(), createdByUserId: jobCreator, status: 'active', request: 'Add deals to the admin', design: { title: 'Add deals' }, publishing: { source: { type: 'mailbox', watchId: String(watch._id) } } });
  return { box, watch };
}

describe('telling people a mailbox needs reconnecting', () => {
  it('emails the job and watch creators once, with a link that reconnects that mailbox', async () => {
    const { box } = await scanner();
    const send = vi.fn(async () => undefined);
    expect(await markMailboxDisconnected(box._id, 'Google access was revoked or expired.', { send })).toBe(true);
    expect(send.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual(['jo@example.org', 'wes@example.org']);
    const [, subject, body] = send.mock.calls[0] as unknown as [string, string, { html: string; text: string }];
    expect(subject).toContain(EMAIL);
    expect(body.text).toContain(reconnectLink(EMAIL));
    expect(body.text).toContain('Add deals');
    expect(body.text).toContain('Casino deals');
    expect(await WatchMailbox.findById(box._id).lean()).toMatchObject({ status: 'needs_reauth', lastError: expect.stringContaining('revoked') });
    expect((await WatchMailbox.findById(box._id).lean())?.reauthNotifiedAt).toBeInstanceOf(Date);
    // Scans keep hitting the same problem: no second email.
    expect(await markMailboxDisconnected(box._id, 'again', { send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never emails someone outside the organization, and falls back to whoever connected it', async () => {
    const outsider = await person('Out Sider', 'out@example.org', new Types.ObjectId());
    const connector = await person('Con Nector', 'con@example.org');
    const box = await mailbox({ connectedByUserId: connector });
    await ContentWatch.create({ organizationId: org, createdByUserId: outsider, mailboxId: box._id, name: 'W', description: 'd' });
    const send = vi.fn(async () => undefined);
    await markMailboxDisconnected(box._id, 'gone', { send });
    expect(send).not.toHaveBeenCalled();
    const lone = await mailbox({ emailAddress: 'other@example.org', connectedByUserId: connector });
    await markMailboxDisconnected(lone._id, 'gone', { send });
    expect((send.mock.calls[0] as unknown[])[0]).toBe('con@example.org');
  });

  it('retries the email on the daily check when sending failed', async () => {
    const { box } = await scanner();
    await markMailboxDisconnected(box._id, 'gone', { send: async () => { throw new Error('Brevo down'); } });
    expect((await WatchMailbox.findById(box._id).lean())?.reauthNotifiedAt).toBeUndefined();
    const send = vi.fn(async () => undefined);
    expect(await checkMailboxConnections({ send })).toMatchObject({ emailed: 2 });
    expect(await checkMailboxConnections({ send })).toMatchObject({ emailed: 0 });
  });

  it('points at the consent screen when a connection dies 7 days after connecting', () => {
    const now = Date.now();
    expect(disconnectMessage('Gone.', new Date(now - 7 * DAY), now)).toContain('Testing');
    expect(disconnectMessage('Gone.', new Date(now - 30 * DAY), now)).toBe('Gone.');
    expect(disconnectMessage('Gone.', null, now)).toBe('Gone.');
  });
});

describe('keeping a mailbox connected', () => {
  it('uses each token daily, keeps a replacement token, and skips ones checked recently', async () => {
    const box = await mailbox();
    const refresh = vi.fn(async () => ({ accessToken: 'a', expiresInSeconds: 3600, refreshToken: 'new-refresh' }));
    expect(await checkMailboxConnections({ refresh })).toMatchObject({ checked: 1, disconnected: 0 });
    expect((refresh.mock.calls[0] as unknown[])[0]).toBe('refresh-token');
    expect(await checkMailboxConnections({ refresh })).toMatchObject({ checked: 0 });
    expect(await checkMailboxConnections({ refresh, now: Date.now() + 2 * DAY })).toMatchObject({ checked: 1 });
    expect((refresh.mock.calls[1] as unknown[])[0]).toBe('new-refresh');
    expect(await WatchMailbox.findById(box._id).lean()).toMatchObject({ status: 'connected' });
  });

  it('disconnects only when Google says the grant is gone, never for an outage or our own config problem', async () => {
    const box = await mailbox();
    const outage = vi.fn(async () => { throw new Error('Google token endpoint returned 500'); });
    expect(await checkMailboxConnections({ refresh: outage })).toMatchObject({ failed: 1, disconnected: 0 });
    expect(await WatchMailbox.findById(box._id).lean()).toMatchObject({ status: 'connected' });
    const send = vi.fn(async () => undefined);
    const revoked = vi.fn(async () => { throw new GmailAuthError('Google access was revoked or expired.'); });
    expect(await checkMailboxConnections({ refresh: revoked, send })).toMatchObject({ disconnected: 1 });
    expect(await WatchMailbox.findById(box._id).lean()).toMatchObject({ status: 'needs_reauth' });
  });

  it('keeps the mailbox connected when Gmail rejects an access token but Google issues a new one', async () => {
    const { box, watch } = await scanner();
    const api = { listMessageIds: async () => { throw new GmailAccessTokenRejected('Google access was revoked or expired.'); } } as unknown as GmailApi;
    const alive = vi.fn(async () => ({ accessToken: 'fresh', expiresInSeconds: 3600 }));
    expect(await scanWatch(watch._id as Types.ObjectId, { api, refresh: alive, analyze: async () => null })).toMatchObject({ ok: false, needsReauth: false });
    expect(await WatchMailbox.findById(box._id).lean()).toMatchObject({ status: 'connected' });
    const gone = vi.fn(async () => { throw new GmailAuthError('Google access was revoked or expired.'); });
    expect(await scanWatch(watch._id as Types.ObjectId, { api, refresh: gone, analyze: async () => null })).toMatchObject({ ok: false, needsReauth: true });
    expect(await WatchMailbox.findById(box._id).lean()).toMatchObject({ status: 'needs_reauth' });
  });
});
