import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('./scanAi', () => ({ analyzeEmail: vi.fn() }));

import { ContentWatch, WatchItem, WatchMailbox } from '@/lib/models/Watch';
import { sealSecret } from '@/lib/security/secretBox';
import { GmailAuthError, type GmailApi } from '@/lib/mail/gmailClient';
import type { GmailMessage } from '@/lib/mail/gmailParse';
import { scanWatch, scanDueWatches, watchMailboxPurpose } from './runWatch';
import type { AnalyzeFn } from './scanAi';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const user = new Types.ObjectId();

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-watches';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_watches_test'));
  await Promise.all([ContentWatch.syncIndexes(), WatchItem.syncIndexes(), WatchMailbox.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const NOW = Date.now();

function email(id: string, over: { from?: string; subject?: string; text?: string; labels?: string[]; html?: string } = {}): GmailMessage {
  const text = over.text ?? `${'This is a long enough email body about the topic we care about. '.repeat(6)}`;
  return {
    id,
    threadId: `t-${id}`,
    labelIds: over.labels ?? ['INBOX'],
    internalDate: String(NOW - 3600_000),
    payload: {
      mimeType: over.html ? 'multipart/alternative' : 'text/plain',
      headers: [
        { name: 'From', value: over.from ?? 'Sender <news@example.com>' },
        { name: 'To', value: 'me@example.org' },
        { name: 'Subject', value: over.subject ?? 'Weekly update' },
      ],
      ...(over.html
        ? { parts: [{ mimeType: 'text/plain', body: { data: b64(text) } }, { mimeType: 'text/html', body: { data: b64(over.html) } }] }
        : { body: { data: b64(text) } }),
    },
  };
}

function fakeApi(messages: GmailMessage[], opts: { failList?: Error } = {}) {
  const calls = { list: 0, get: [] as string[] };
  const api = {
    async listMessageIds() {
      calls.list += 1;
      if (opts.failList) throw opts.failList;
      return { ids: messages.map((m) => m.id), nextPageToken: undefined };
    },
    async getMessage(id: string) {
      calls.get.push(id);
      const found = messages.find((m) => m.id === id);
      if (!found) throw new Error('Gmail /messages returned 404');
      return found;
    },
  } as unknown as GmailApi;
  return { api, calls };
}

let mailboxId: Types.ObjectId;
async function makeWatch(over: Record<string, unknown> = {}) {
  const w = await ContentWatch.create({ organizationId: org, createdByUserId: user, mailboxId, name: 'Test watch', mode: 'match', description: 'New product launches', threshold: 60, ...over });
  return w._id as Types.ObjectId;
}

beforeEach(async () => {
  await Promise.all([ContentWatch.deleteMany({}), WatchItem.deleteMany({}), WatchMailbox.deleteMany({})]);
  const mailbox = await WatchMailbox.create({ organizationId: org, emailAddress: 'me@example.org', refreshTokenSealed: sealSecret(watchMailboxPurpose('me@example.org'), 'refresh-token'), status: 'connected' });
  mailboxId = mailbox._id;
});

const scoreBy = (scores: Record<string, number>): AnalyzeFn => async (input) => ({
  match: { score: scores[input.subject] ?? 0, reason: `scored ${scores[input.subject] ?? 0}` },
  summary: `Summary of ${input.subject}`,
  keyPoints: [{ category: 'offer', text: 'Ships Friday' }],
  deal: null,
  values: {},
});

describe('scanning a watch', () => {
  it('flags emails at or above the threshold, skips the rest, and never rescans what it has seen', async () => {
    const watchId = await makeWatch({ senderDomains: ['example.com'] });
    const { api, calls } = fakeApi([
      email('1', { subject: 'Big launch' }),
      email('2', { subject: 'Meh newsletter' }),
      email('3', { subject: 'Tiny', text: 'short' }),
      email('4', { subject: 'Wrong sender', from: 'x@other.org' }),
    ]);
    const analyze = vi.fn(scoreBy({ 'Big launch': 85, 'Meh newsletter': 20 }));

    const first = await scanWatch(watchId, { api, analyze });
    expect(first).toMatchObject({ ok: true, stats: { listed: 4, fresh: 4, stored: 4, skipped: 2, scored: 2, flagged: 1 } });
    const items = await WatchItem.find({ watchId }).sort({ gmailId: 1 }).lean();
    expect(items.map((i) => [i.gmailId, i.flagged, i.score, i.skipReason ?? null])).toEqual([
      ['1', true, 85, null],
      ['2', false, 20, null],
      ['3', false, 0, 'body_too_short:5'],
      ['4', false, 0, 'sender_filter_mismatch'],
    ]);
    expect(items[0]).toMatchObject({ scoreBasis: 'ai', reason: 'scored 85', summary: 'Summary of Big launch', keyPoints: [{ category: 'offer', text: 'Ships Friday' }] });
    expect(analyze).toHaveBeenCalledTimes(2);

    const second = await scanWatch(watchId, { api, analyze });
    expect(second).toMatchObject({ ok: true, stats: { listed: 4, fresh: 0, stored: 0 } });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(calls.get).toHaveLength(4);
    expect(await ContentWatch.findById(watchId).lean()).toMatchObject({ lastScanOk: true });
  });

  it('falls back to the keyword score when no model answers, and says so in the stats', async () => {
    const watchId = await makeWatch({ description: '', keywords: ['launch', 'beta'], threshold: 50, aiSummary: false });
    const { api } = fakeApi([email('1', { subject: 'Launch day', text: `${'Our beta launch is here. '.repeat(10)}` })]);
    const result = await scanWatch(watchId, { api, analyze: async () => null });
    expect(result).toMatchObject({ ok: true, stats: { scored: 1, flagged: 1 } });
    expect(await WatchItem.findOne({ watchId }).lean()).toMatchObject({ scoreBasis: 'keywords', score: 100, flagged: true });
  });

  it('scores a deal watch by deal strength and keeps the deal', async () => {
    const watchId = await makeWatch({ mode: 'deal', description: '', threshold: 25, aiSummary: false });
    const { api } = fakeApi([
      email('1', { subject: 'Pay $20 and get $26 in bonus credits', text: `${'Limited time offer for our members. '.repeat(6)}` }),
      email('2', { subject: 'Newsletter', text: `${'No offers here, only news and updates for you. '.repeat(6)}` }),
    ]);
    const result = await scanWatch(watchId, { api, analyze: async () => null });
    expect(result).toMatchObject({ ok: true, stats: { scored: 2, flagged: 1 } });
    const deal = await WatchItem.findOne({ watchId, gmailId: '1' }).lean();
    expect(deal).toMatchObject({ flagged: true, scoreBasis: 'deal', score: 30 });
    expect(deal?.bestDeal).toMatchObject({ you_pay: 20, baseline_value: 26 });
    expect(await WatchItem.findOne({ watchId, gmailId: '2' }).lean()).toMatchObject({ flagged: false, score: 0 });
  });

  it("collects the watch's own fields and ranks by fit", async () => {
    const watchId = await makeWatch({ rank: 'fit', description: 'AI industry news', threshold: 50, fields: [{ key: 'company', label: 'Company', kind: 'text' }, { key: 'source_link', label: 'Source link', kind: 'url' }] });
    const { api } = fakeApi([email('1', { subject: 'Lab ships a new model' }), email('2', { subject: 'Webinar invite' })]);
    const seen: string[][] = [];
    await scanWatch(watchId, {
      api,
      analyze: async (input) => {
        seen.push(input.fields.map((f) => f.key));
        const strong = input.subject.startsWith('Lab');
        const values: Record<string, string> = strong ? { company: 'Acme AI', source_link: 'https://acme.ai/news' } : {};
        return { match: { score: strong ? 85 : 20, reason: 'r' }, summary: 's', keyPoints: [], deal: null, values };
      },
    });
    expect(seen[0]).toEqual(['company', 'source_link']);
    expect(await WatchItem.findOne({ watchId, gmailId: '1' }).lean()).toMatchObject({ flagged: true, score: 85, fit: 85, values: { company: 'Acme AI', source_link: 'https://acme.ai/news' } });
    expect(await WatchItem.findOne({ watchId, gmailId: '2' }).lean()).toMatchObject({ flagged: false, fit: 20 });
  });

  it('does not cap a discount at 100%, and a discount watch with a rule needs both a fit and an offer', async () => {
    const watchId = await makeWatch({ rank: 'discount', mode: 'deal', description: 'Sweepstakes casino offers', threshold: 50, minDiscountPct: 50, aiSummary: false });
    const { api } = fakeApi([
      email('1', { subject: 'Pay $10 and get $40 in bonus credits', text: `${'Limited time offer for our members. '.repeat(6)}` }),
      email('2', { subject: 'Pay $10 and get $40 in bonus credits!', text: `${'A different shop with the same promo for you. '.repeat(6)}` }),
    ]);
    await scanWatch(watchId, { api, analyze: async (input) => ({ match: { score: input.subject.endsWith('!') ? 10 : 90, reason: 'r' }, summary: '', keyPoints: [], deal: null, values: {} }) });
    const strong = await WatchItem.findOne({ watchId, gmailId: '1' }).lean();
    expect(strong).toMatchObject({ flagged: true, scoreBasis: 'deal', fit: 90 });
    expect(strong?.score).toBeGreaterThan(100);
    expect(await WatchItem.findOne({ watchId, gmailId: '2' }).lean()).toMatchObject({ flagged: false, fit: 10 });
  });

  it('stores the best link and a sanitized preview, never raw scripts', async () => {
    const watchId = await makeWatch({ description: '', keywords: ['launch'], threshold: 10, aiSummary: false });
    const html = '<p>Launch today</p><script>alert(1)</script><a href="https://example.com/unsubscribe">Unsubscribe</a><a href="https://shop.example.com/claim-offer">Claim now</a>';
    const { api } = fakeApi([email('1', { subject: 'Launch', text: `${'Launch news for everyone. '.repeat(10)}`, html })]);
    await scanWatch(watchId, { api, analyze: async () => null });
    const item = await WatchItem.findOne({ watchId }).lean();
    expect(item?.link).toBe('https://shop.example.com/claim-offer');
    expect(item?.htmlPreview).not.toContain('<script');
  });

  it('stops at the per-scan limit and continues next time', async () => {
    const watchId = await makeWatch({ description: '', keywords: ['topic'], aiSummary: false });
    const { api } = fakeApi(['1', '2', '3'].map((id) => email(id)));
    const first = await scanWatch(watchId, { api, analyze: async () => null, maxNew: 2 });
    expect(first).toMatchObject({ ok: true, stats: { stored: 2, partial: true } });
    const second = await scanWatch(watchId, { api, analyze: async () => null, maxNew: 2 });
    expect(second).toMatchObject({ ok: true, stats: { fresh: 1, stored: 1, partial: false } });
    expect(await WatchItem.countDocuments({ watchId })).toBe(3);
  });

  it('marks the mailbox as needing reconnection when Google revokes access', async () => {
    const watchId = await makeWatch();
    const { api } = fakeApi([], { failList: new GmailAuthError('Google access was revoked or expired.') });
    expect(await scanWatch(watchId, { api, analyze: async () => null })).toMatchObject({ ok: false, needsReauth: true });
    expect(await WatchMailbox.findById(mailboxId).lean()).toMatchObject({ status: 'needs_reauth' });
    expect(await ContentWatch.findById(watchId).lean()).toMatchObject({ lastScanOk: false });
    expect(await scanWatch(watchId, { analyze: async () => null })).toMatchObject({ ok: false, needsReauth: true });
  });

  it('refuses a second scan while one is running', async () => {
    const watchId = await makeWatch();
    await ContentWatch.updateOne({ _id: watchId }, { $set: { scanLeaseUntil: new Date(Date.now() + 60_000) } });
    expect(await scanWatch(watchId, { analyze: async () => null })).toMatchObject({ ok: false, error: expect.stringContaining('already being scanned') });
  });
});

describe('scanning what is due', () => {
  it('scans active watches whose interval has passed, skipping paused ones and mailboxes needing reconnection', async () => {
    const due = await makeWatch({ name: 'due', intervalMinutes: 60, lastScanAt: new Date(Date.now() - 2 * 3600_000) });
    await makeWatch({ name: 'recent', intervalMinutes: 60, lastScanAt: new Date(Date.now() - 5 * 60_000) });
    await makeWatch({ name: 'paused', active: false });
    const otherMailbox = await WatchMailbox.create({ organizationId: org, emailAddress: 'old@example.org', refreshTokenSealed: 'x', status: 'needs_reauth' });
    await makeWatch({ name: 'broken', mailboxId: otherMailbox._id });
    // Only the due watch on a healthy mailbox is attempted; with no Google credentials it fails fast but is still counted.
    const result = await scanDueWatches({ limit: 5 });
    expect(result.scanned + result.failed).toBe(1);
    expect((await ContentWatch.findById(due).lean())?.lastScanAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
