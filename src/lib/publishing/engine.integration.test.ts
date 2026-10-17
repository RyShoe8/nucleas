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
import { PublishError } from './publishers';
import { markPosted, postDeliveryNow, publishingView, recoverStuckDeliveries, runPublishing, skipDelivery, takeBaseline, type PublishDeps } from './engine';
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
  await Promise.all([Job.deleteMany({}), JobRun.deleteMany({}), PublishItem.deleteMany({}), PublishDelivery.deleteMany({}), BrandVoice.deleteMany({}), IntegrationConnection.deleteMany({}), User.deleteMany({})]);
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
    expect(await postDeliveryNow(job.toObject(), String(facebook!._id), String(userId), deps())).toEqual({ ok: true });
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
