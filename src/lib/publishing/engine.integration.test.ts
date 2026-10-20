import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/services/email', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/ai/engine/ask', () => ({ askEngine: vi.fn(async () => null) }));
vi.mock('@/lib/integrations/connections', () => ({ readConnectionCredential: vi.fn(async () => 'credential') }));
const company = vi.hoisted(() => ({ id: 'c'.repeat(24) }));
vi.mock('@/lib/companies/companyProfile', () => ({
  loadCompanyViewer: async (userId: string) => ({ userId, organizationId: new (await import('mongoose')).Types.ObjectId(), employeeId: null, role: 'Administrator' }),
  getCompanyProfile: async (_v: unknown, id: string) => (id === company.id ? { id, name: 'PlayBound', domain: 'playbound.club', subreddit: 'PlayBoundGaming', socialLinks: [] } : null),
}));

import { Job, JobRun } from '@/lib/models/Job';
import { PublishDelivery, PublishItem } from '@/lib/models/Publishing';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { IntegrationConnection } from '@/lib/models/Integration';
import User from '@/lib/models/User';
import { WatchItem } from '@/lib/models/Watch';
import type { AdminBrowser } from './admin';
import { PublishError } from './publishers';
import { queueExistingAdminItem, markPosted, postDeliveryNow, publishingView, recoverStuckDeliveries, runPublishing, skipDelivery, takeBaseline, type PublishDeps } from './engine';
import type { PublishingConfig } from './config';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const companyId = new Types.ObjectId(company.id);
let userId: Types.ObjectId;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_publishing_test'));
  await Promise.all([Job.syncIndexes(), JobRun.syncIndexes(), PublishItem.syncIndexes(), PublishDelivery.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

let pages: string[];
const sitemap = () => `<urlset>${pages.map((p) => `<url><loc>https://playbound.club/games/${p}</loc></url>`).join('')}</urlset>`;
const fetcher = async (url: string) => {
  if (url === 'https://playbound.club/sitemap.xml') return new Response(sitemap(), { status: 200 });
  const slug = /\/games\/([a-z0-9-]+)$/.exec(url)?.[1];
  if (slug && pages.includes(slug)) return new Response(`<meta property="og:title" content="Game ${slug}"><meta property="og:description" content="About ${slug}"><meta property="og:image" content="https://playbound.club/${slug}.jpg"><main>Text</main>`, { status: 200 });
  return new Response('missing', { status: 404 });
};

const config: PublishingConfig = {
  source: { type: 'site', feedUrl: 'https://playbound.club/sitemap.xml', feedKind: 'sitemap', pathPrefix: '/games/', noun: 'game' },
  channels: [{ platform: 'facebook', mode: 'auto' }, { platform: 'bluesky', mode: 'auto' }, { platform: 'reddit', mode: 'manual' }],
  examples: { reddit: { text: 'Title: New Game Release: X\n\nBody' } },
  notifyUserIds: [],
  brief: 'Post every new game to our socials',
};

const write = async ({ system }: { system: string }) => (system.includes('{"title"') ? JSON.stringify({ title: 'New Game Release', body: 'Reddit body' }) : JSON.stringify({ body: 'A new game is here.' }));

let sent: { to: string; subject: string }[];
let published: { platform: string; text: string }[];
let failFacebook: PublishError | null;
const deps = (): PublishDeps => ({
  fetcher,
  write,
  send: async (to, subject) => {
    sent.push({ to, subject });
  },
  publish: {
    bluesky: async (_c, input) => {
      published.push({ platform: 'bluesky', text: input.text });
      return { url: `https://bsky.app/profile/pb/post/${published.length}` };
    },
    facebook: async (_c, input) => {
      if (failFacebook) throw failFacebook;
      published.push({ platform: 'facebook', text: input.text });
      return { url: `https://www.facebook.com/1_${published.length}` };
    },
  },
});

async function newRun(jobId: Types.ObjectId, dryRun: boolean) {
  return JobRun.create({ organizationId: org, jobId, companyId, dryRun, status: 'running', startedAt: new Date(), leaseOwner: 'owner', leaseExpiresAt: new Date(Date.now() + 600_000), progressState: { stage: 'preparing', label: 'x', percent: 5, updatedAt: new Date() } });
}

async function newJob() {
  return Job.create({ organizationId: org, companyId, createdByUserId: userId, status: 'testing', request: config.brief, publishing: { ...config, notifyUserIds: [String(userId)] }, design: { skill: 'social_publish' } });
}

beforeEach(async () => {
  await Promise.all([Job.deleteMany({}), JobRun.deleteMany({}), PublishItem.deleteMany({}), PublishDelivery.deleteMany({}), BrandVoice.deleteMany({}), IntegrationConnection.deleteMany({}), User.deleteMany({}), WatchItem.deleteMany({})]);
  userId = (await User.create({ name: 'Ryan Shoe', email: 'ryan@example.com', organizationId: String(org), password: 'x'.repeat(20) }))._id as Types.ObjectId;
  await BrandVoice.create({ organizationId: org, companyId, persona: 'Warm and nerdy. Short sentences.', status: 'approved', updatedByUserId: userId });
  await IntegrationConnection.create([
    { organizationId: org, companyId, provider: 'facebook', scope: 'company', status: 'connected', source: 'manual' },
    { organizationId: org, companyId, provider: 'bluesky', scope: 'company', status: 'connected', source: 'manual' },
  ]);
  pages = ['deus-ex', 'openra'];
  sent = [];
  published = [];
  failFacebook = null;
});

describe('publishing jobs', () => {
  it('drafts samples on a dry run without recording or posting anything', async () => {
    const job = await newJob();
    const run = await newRun(job._id, true);
    await runPublishing(run, 'owner', job.toObject(), deps());
    const done = await JobRun.findById(run._id).lean();
    expect(done?.status).toBe('needs_review');
    const output = done?.output as { records: { values: Record<string, unknown> }[] };
    expect(output.records.map((r) => r.values.platform)).toEqual(['Facebook', 'Bluesky', 'Reddit']);
    expect(output.records[2]!.values).toMatchObject({ post_title: 'New Game Release', post_copy: 'Reddit body', target_url: 'https://playbound.club/games/openra' });
    expect(await PublishItem.countDocuments()).toBe(0);
    expect(published).toEqual([]);
    expect(sent).toEqual([{ to: 'ryan@example.com', subject: 'Sample posts ready to check · PlayBound' }]);
  });

  it('keeps platform drafts separate, caps Bluesky, and uses the game page in an explicitly existing-item preview', async () => {
    const job = await newJob();
    const run = await newRun(job._id, true);
    const calls: string[] = [];
    await runPublishing(run, 'owner', job.toObject(), { ...deps(), write: async ({ system }) => {
      calls.push(system);
      return JSON.stringify({ title: 'Game title', body: 'Useful game facts. '.repeat(50) });
    } });
    const done = await JobRun.findById(run._id).lean();
    const output = done?.output as { summary: string; records: { values: Record<string, unknown> }[] };
    const bluesky = output.records.find((r) => r.values.platform === 'Bluesky')!;
    const facebook = output.records.find((r) => r.values.platform === 'Facebook')!;
    expect([...String(bluesky.values.post_copy)].length).toBeLessThanOrEqual(300);
    expect(String(facebook.values.post_copy).length).toBeGreaterThan(300);
    expect(output.records.every((r) => r.values.target_url === 'https://playbound.club/games/openra')).toBe(true);
    expect(output.summary).toContain('existing game');
    expect(output.summary).toContain('not a new-publication notification');
    expect(calls.some((system) => system.includes('Bluesky'))).toBe(true);
    expect(published).toEqual([]);
  });

  it('posts only what appears after the baseline: auto channels publish, manual ones become cards', async () => {
    const job = await newJob();
    expect(await takeBaseline(job.toObject(), deps())).toBe(2);

    const quiet = await newRun(job._id, false);
    await runPublishing(quiet, 'owner', (await Job.findById(job._id).lean())!, deps());
    expect((await JobRun.findById(quiet._id).lean())?.output).toMatchObject({ summary: 'No new games.' });
    expect(sent).toEqual([]);

    pages.push('factorio');
    const run = await newRun(job._id, false);
    await runPublishing(run, 'owner', (await Job.findById(job._id).lean())!, deps());
    expect(published.map((p) => p.platform)).toEqual(['facebook', 'bluesky']);
    const deliveries = await PublishDelivery.find().sort({ platform: 1 }).lean();
    expect(deliveries.map((d) => [d.platform, d.status])).toEqual([['bluesky', 'posted'], ['facebook', 'posted'], ['reddit', 'ready']]);
    expect(deliveries.find((d) => d.platform === 'reddit')).toMatchObject({ title: 'New Game Release', link: 'https://playbound.club/games/factorio', assets: [{ kind: 'image', url: 'https://playbound.club/factorio.jpg' }] });
    expect(sent).toEqual([{ to: 'ryan@example.com', subject: '1 post ready to post · PlayBound' }]);

    // The next hour finds nothing new and posts nothing again.
    const again = await newRun(job._id, false);
    await runPublishing(again, 'owner', (await Job.findById(job._id).lean())!, deps());
    expect(published).toHaveLength(2);
    expect(await PublishDelivery.countDocuments()).toBe(3);
  });

  it('turns a failed automatic post into a card and switches that channel to manual with a note', async () => {
    const job = await newJob();
    await takeBaseline(job.toObject(), deps());
    failFacebook = new PublishError('needs_permission', 'The Facebook connection is not allowed to post.');
    pages.push('factorio');
    const run = await newRun(job._id, false);
    await runPublishing(run, 'owner', (await Job.findById(job._id).lean())!, deps());
    const facebook = await PublishDelivery.findOne({ platform: 'facebook' }).lean();
    expect(facebook).toMatchObject({ status: 'ready', error: expect.stringContaining('not allowed to post') });
    const view = await publishingView((await Job.findById(job._id).lean())!);
    expect(view?.channels.find((c) => c.platform === 'facebook')?.mode).toBe('manual');
    expect(view?.notes.facebook).toContain('not allowed to post');
    expect(view?.ready.map((d) => d.platform).sort()).toEqual(['facebook', 'reddit']);

    // Once the account is fixed, the card can be posted through the API.
    failFacebook = null;
    const itemRead = vi.spyOn(PublishItem, 'findById').mockImplementationOnce(() => {
      throw Object.assign(new Error('TLS pool reset'), { name: 'MongoNetworkError' });
    });
    const before = published.length;
    expect(await postDeliveryNow(job.toObject(), String(facebook!._id), String(userId), deps())).toEqual({ ok: true });
    expect(itemRead).toHaveBeenCalledTimes(2);
    itemRead.mockRestore();
    expect(published).toHaveLength(before + 1);
    expect(await PublishDelivery.findById(facebook!._id).lean()).toMatchObject({ status: 'posted', postedUrl: expect.stringContaining('facebook.com') });
  });

  it('records a burst of new pages as a site change instead of posting them', async () => {
    const job = await newJob();
    await takeBaseline(job.toObject(), deps());
    pages.push('a', 'b', 'c', 'd', 'e', 'f');
    const run = await newRun(job._id, false);
    await runPublishing(run, 'owner', (await Job.findById(job._id).lean())!, deps());
    expect(published).toEqual([]);
    expect(await PublishItem.countDocuments({ status: 'skipped' })).toBe(6);
    expect(sent[0]?.subject).toBe('Nothing posted: 6 games appeared at once · PlayBound');
  });

  it('records the existing pages on its first run if the baseline was never taken', async () => {
    const job = await newJob();
    const run = await newRun(job._id, false);
    await runPublishing(run, 'owner', job.toObject(), deps());
    expect(await PublishItem.countDocuments({ status: 'baseline' })).toBe(2);
    expect(published).toEqual([]);
  });

  it('fails clearly without an approved Voice, returning a dry run to the design', async () => {
    await BrandVoice.deleteMany({});
    const job = await newJob();
    const run = await newRun(job._id, true);
    await runPublishing(run, 'owner', job.toObject(), deps());
    expect(await JobRun.findById(run._id).lean()).toMatchObject({ status: 'failed', error: expect.stringContaining('Voice') });
    expect((await Job.findById(job._id).lean())?.status).toBe('proposed');
  });

  it('lets a person mark a card posted once, or skip it', async () => {
    const job = await newJob();
    await takeBaseline(job.toObject(), deps());
    pages.push('factorio');
    await runPublishing(await newRun(job._id, false), 'owner', (await Job.findById(job._id).lean())!, deps());
    const reddit = await PublishDelivery.findOne({ platform: 'reddit' }).lean();
    expect(await markPosted(job, String(reddit!._id), String(userId), 'not a link')).toMatchObject({ ok: false, status: 400 });
    expect(await markPosted(job, String(reddit!._id), String(userId), 'https://www.reddit.com/r/PlayBoundGaming/comments/1')).toEqual({ ok: true });
    expect(await markPosted(job, String(reddit!._id), String(userId))).toMatchObject({ ok: false, status: 409 });
    expect(await skipDelivery(job, String(reddit!._id), String(userId))).toMatchObject({ ok: false, status: 409 });
    expect(await PublishDelivery.findById(reddit!._id).lean()).toMatchObject({ status: 'posted', postedUrl: 'https://www.reddit.com/r/PlayBoundGaming/comments/1' });
  });

  it('returns a post stuck mid-publish to the cards with a warning, never retrying it', async () => {
    const job = await newJob();
    const item = await PublishItem.create({ organizationId: org, jobId: job._id, companyId, key: 'k', status: 'processed' });
    const stuck = await PublishDelivery.create({ organizationId: org, jobId: job._id, companyId, itemId: item._id, platform: 'bluesky', mode: 'auto', status: 'publishing', body: 'x' });
    await PublishDelivery.collection.updateOne({ _id: stuck._id }, { $set: { updatedAt: new Date(Date.now() - 30 * 60_000) } });
    expect(await recoverStuckDeliveries()).toBe(1);
    expect(await PublishDelivery.findById(stuck._id).lean()).toMatchObject({ status: 'ready', error: expect.stringContaining('may already be live') });
  });
});

describe('admin publishing jobs (deals from the inbox into the site admin)', () => {
  const watchId = new Types.ObjectId();
  const mailboxId = new Types.ObjectId();
  const fields = [
    { key: 'casino', label: 'Casino', type: 'text' as const, selector: '#casino', required: true },
    { key: 'offer', label: 'Offer', type: 'textarea' as const, selector: '#offer', required: true },
  ];
  const adminConfig = {
    source: { type: 'mailbox' as const, watchId: String(watchId), noun: 'deal' },
    channels: [{ platform: 'admin' as const, mode: 'auto' as const }],
    examples: {},
    notifyUserIds: [] as string[],
    brief: 'Add the best casino deals from our email to the admin',
    admin: { baseUrl: 'https://fg.club', formUrl: 'https://fg.club/admin/deals/new', listUrl: 'https://fg.club/admin/deals', fields, submit: { selector: 'button', label: 'Save' }, learnedAt: '2026-10-17' },
  };
  const deal = (pay: number, credit: number) => ({ mode: 'pay_vs_credited_value', you_pay: pay, baseline_value: credit, pay_unit: 'USD', credit_unit: 'SC', units_comparable: false, effective_savings_pct: 0, bonus_pct: credit / pay - 1, confidence: 0.9, source: 'regex' });
  let n = 0;
  const email = (from: string, subject: string, pay: number, credit: number) =>
    WatchItem.create({ organizationId: org, watchId, mailboxId, gmailId: `g${(n += 1)}`, fromEmail: from, fromName: 'Golden Hearts', subject, sentAt: new Date(Date.now() - (100 - n) * 60_000), flagged: true, summary: subject, bestDeal: deal(pay, credit) });
  let saved: Record<string, unknown>[];
  let signedIn: boolean;
  const browser: AdminBrowser = {
    inspect: async () => ({ url: '', title: '', loggedIn: signedIn, fields, submit: { selector: 'button', label: 'Save' }, links: [], headings: [] }),
    fill: async (_s, input) => {
      if (!signedIn) return { url: input.url, title: '', loggedIn: false, submitted: false, missing: [], errors: [], text: '', screenshot: null };
      if (input.submit) saved.push(input.values);
      return { url: 'https://fg.club/admin/deals', title: '', loggedIn: true, submitted: input.submit, missing: [], errors: [], text: '', screenshot: 'jpeg-base64' };
    },
    read: async () => ({ loggedIn: true, text: saved.map((v) => `${v.casino} ${v.offer}`).join('\n') }),
  };
  const adminWrite = async ({ user }: { user: string }) => JSON.stringify({ casino: 'Golden Hearts', offer: /Deal: (.*)/.exec(user)?.[1] ?? 'offer' });
  const adminDeps = (): PublishDeps => ({ ...deps(), write: adminWrite, admin: browser, adminSession: { baseUrl: 'https://fg.club', cookies: [] } });
  const adminJob = () => Job.create({ organizationId: org, companyId, createdByUserId: userId, status: 'testing', request: adminConfig.brief, publishing: adminConfig, design: { skill: 'social_publish' } });

  beforeEach(async () => {
    await BrandVoice.deleteMany({});
    saved = [];
    signedIn = true;
  });

  it('publishes admin records but only enables site sharing above 30% verified value', async () => {
    const ruleFields = [
      ...fields,
      { key: 'status', label: 'Status', type: 'select' as const, selector: '#status', required: true, options: [{ value: 'published', label: 'Published' }] },
      { key: 'facebook', label: 'Facebook', type: 'checkbox' as const, selector: '#facebook', required: false },
      { key: 'bluesky', label: 'Bluesky', type: 'checkbox' as const, selector: '#bluesky', required: false },
    ];
    const job = await adminJob();
    await Job.updateOne({ _id: job._id }, { $set: { 'publishing.admin.fields': ruleFields, 'publishing.adminFieldRules': [
      { field: 'status', value: 'published' },
      { field: 'facebook', value: true, otherwise: false, whenValueOverPct: 30 },
      { field: 'bluesky', value: true, otherwise: false, whenValueOverPct: 30 },
    ] } });
    const current = (await Job.findById(job._id).lean())!;
    await takeBaseline(current, adminDeps());
    await email('a@example.com', 'Below thirty', 100, 120);
    await email('b@example.com', 'Exactly thirty', 100, 130);
    await email('c@example.com', 'Above thirty', 100, 140);
    await runPublishing(await newRun(job._id, false), 'owner', current, adminDeps());
    expect(saved).toHaveLength(3);
    expect(saved.map((v) => [v.status, v.facebook, v.bluesky])).toEqual([
      ['published', false, false], ['published', false, false], ['published', true, true],
    ]);
  });

  it('waits for admin submission and links mailbox social drafts to the public record', async () => {
    await BrandVoice.create({ organizationId: org, companyId, persona: 'Helpful.', status: 'approved', updatedByUserId: userId });
    const item = await email('a@example.com', 'New deal', 50, 75);
    const admin = await adminJob();
    await Job.updateOne({ _id: admin._id }, { $set: { status: 'ready' } });
    await queueExistingAdminItem({ userId: String(userId), organizationId: org, employeeId: null, role: 'Administrator' }, String(item._id), adminDeps());
    const card = await PublishDelivery.findOne({ jobId: admin._id, platform: 'admin' });
    await PublishDelivery.updateOne({ _id: card!._id }, { $set: { 'values.slug': 'new-deal' } });
    const social = await newJob();
    await Job.updateOne({ _id: social._id }, { $set: { publishing: { source: adminConfig.source, channels: [{ platform: 'reddit', mode: 'manual' }], socialLinkTemplate: 'https://fg.club/deals/{slug}' } } });
    const current = (await Job.findById(social._id).lean())!;
    expect(await takeBaseline(current, deps())).toBe(0);
    await PublishDelivery.updateOne({ _id: card!._id }, { $set: { status: 'posted' } });
    await runPublishing(await newRun(social._id, false), 'owner', current, deps());
    const draft = await PublishDelivery.findOne({ jobId: social._id, platform: 'reddit' }).lean();
    expect(draft?.link).toBe('https://fg.club/deals/new-deal');
    expect(draft?.body).toContain('https://fg.club/deals/new-deal');
    expect(draft?.body).not.toContain('https://offer');
  });

  it('applies the configured next-day expiry when retrying an old card without an end date', async () => {
    const item = await email('a@example.com', 'Missing expiry', 20, 25);
    const job = await adminJob();
    await Job.updateOne({ _id: job._id }, { $set: { status: 'ready' } });
    await queueExistingAdminItem({ userId: String(userId), organizationId: org, employeeId: null, role: 'Administrator' }, String(item._id), adminDeps());
    const card = await PublishDelivery.findOne({ jobId: job._id, platform: 'admin' });
    await PublishDelivery.updateOne({ _id: card!._id }, { $set: { 'values.start_date': '2099-12-31' } });
    const dates = [{ key: 'start_date', label: 'Start date', type: 'date', selector: '#start_date', required: true }, { key: 'end_date', label: 'End date', type: 'date', selector: '#end_date', required: true }];
    await Job.updateOne({ _id: job._id }, { $set: { 'publishing.admin.fields': [...fields, ...dates], 'publishing.adminDefaultEndDays': 1 } });
    expect(await postDeliveryNow(job.toObject(), String(card!._id), String(userId), adminDeps())).toEqual({ ok: true });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ start_date: '2099-12-31', end_date: '2100-01-01' });
  });

  it('filters social value strictly above 30% without filtering admin intake', async () => {
    await email('a@example.com', 'Low', 100, 120);
    await email('a@example.com', 'Exactly thirty', 100, 130);
    await email('a@example.com', 'Above thirty', 100, 131);
    const job = await adminJob();
    await Job.updateOne({ _id: job._id }, { $set: { 'publishing.minimumSocialValuePct': 30 } });
    expect(await takeBaseline((await Job.findById(job._id).lean())!, adminDeps())).toBe(3);
    await PublishItem.deleteMany({});
    await Job.updateOne({ _id: job._id }, { $set: { publishing: { source: adminConfig.source, channels: [{ platform: 'bluesky', mode: 'manual' }], minimumSocialValuePct: 30 } } });
    expect(await takeBaseline((await Job.findById(job._id).lean())!, deps())).toBe(1);
    expect(await PublishItem.findOne().lean()).toMatchObject({ title: 'Above thirty' });
  });

  it('queues an existing baselined email once for admin review without saving externally', async () => {
    const item = await email('a@example.com', 'Existing offer', 20, 40);
    const job = await adminJob();
    await Job.updateOne({ _id: job._id }, { $set: { status: 'ready' } });
    await takeBaseline((await Job.findById(job._id).lean())!, adminDeps());
    const viewer = { userId: String(userId), organizationId: org, employeeId: null, role: 'Administrator' as const };
    expect(await queueExistingAdminItem(viewer, String(item._id), adminDeps())).toMatchObject({ status: 'ready' });
    expect(await queueExistingAdminItem(viewer, String(item._id), adminDeps())).toMatchObject({ status: 'ready' });
    expect(await PublishDelivery.countDocuments({ jobId: job._id, platform: 'admin' })).toBe(1);
    expect(saved).toEqual([]);
    expect((await PublishDelivery.findOne().lean())?.mode).toBe('manual');
  });

  it('fills the real form on a dry run without saving, and works without a Voice', async () => {
    await email('promo@mail.goldenhearts.com', 'Double your first buy', 20, 40);
    const job = await adminJob();
    const run = await newRun(job._id, true);
    await runPublishing(run, 'owner', job.toObject(), adminDeps());
    const done = await JobRun.findById(run._id).lean();
    expect(done?.status).toBe('needs_review');
    const output = done?.output as { records: { values: Record<string, unknown> }[]; summary: string };
    expect(output.records[0]!.values).toMatchObject({ platform: 'Admin', mode: 'Adds it automatically', screenshot: 'jpeg-base64', post_copy: 'Casino: Golden Hearts\nOffer: $20 → 40 SC (~100% bonus)' });
    expect(output.summary).toContain('filled but not saved');
    expect(saved).toEqual([]);
  });

  it('adds each new deal once, confirms it on the list page, and skips the same deal sent again', async () => {
    await email('promo@mail.goldenhearts.com', 'Old deal', 10, 15);
    const job = await adminJob();
    await takeBaseline(job.toObject(), adminDeps());
    await email('promo@mail.goldenhearts.com', 'Double your first buy', 20, 40);
    await email('news@goldenhearts.com', 'Reminder: double your first buy', 20, 40);
    const run = await newRun(job._id, false);
    await runPublishing(run, 'owner', (await Job.findById(job._id).lean())!, adminDeps());
    expect(saved).toEqual([{ casino: 'Golden Hearts', offer: '$20 → 40 SC (~100% bonus)' }]);
    expect(await PublishDelivery.findOne({ platform: 'admin' }).lean()).toMatchObject({ status: 'posted', postedUrl: 'https://fg.club/admin/deals' });
    expect(await PublishDelivery.findOne({ platform: 'admin' }).lean()).not.toHaveProperty('error');
    expect(await PublishItem.findOne({ title: 'Reminder: double your first buy' }).lean()).toMatchObject({ status: 'skipped', skipReason: 'The same deal as an earlier email.' });
    expect((await JobRun.findById(run._id).lean())?.output).toMatchObject({ summary: expect.stringContaining('1 repeat of earlier deals skipped') });
  });

  it('turns a deal into a ready-to-add card when the admin session expired, and switches the job to manual', async () => {
    const job = await adminJob();
    await takeBaseline(job.toObject(), adminDeps());
    await email('promo@goldenhearts.com', 'Weekend reload', 50, 75);
    signedIn = false;
    await runPublishing(await newRun(job._id, false), 'owner', (await Job.findById(job._id).lean())!, { ...adminDeps(), adminSession: null });
    const card = await PublishDelivery.findOne({ platform: 'admin' }).lean();
    expect(card).toMatchObject({ status: 'ready', values: { casino: 'Golden Hearts' }, error: expect.stringContaining('Reconnect it in Company') });
    const view = await publishingView((await Job.findById(job._id).lean())!);
    expect(view?.channels).toEqual([{ platform: 'admin', mode: 'manual' }]);
    expect(view?.ready[0]?.fields).toEqual([{ label: 'Casino', value: 'Golden Hearts' }, { label: 'Offer', value: '$50 → 75 SC (~50% bonus)' }]);
    expect(view?.admin).toMatchObject({ formUrl: 'https://fg.club/admin/deals/new' });
  });
});
