import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/services/email', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/ai/engine/ask', () => ({ askEngine: vi.fn(async () => null) }));
vi.mock('@/lib/integrations/connections', () => ({ readConnectionCredential: vi.fn(async () => 'credential') }));
const company = vi.hoisted(() => ({ id: 'c'.repeat(24) }));
vi.mock('@/lib/companies/companyProfile', () => ({
  isCompanyManager: (v: { role: string }) => v.role === 'Administrator' || v.role === 'Manager',
  loadCompanyViewer: async (userId: string) => ({ userId, organizationId: new (await import('mongoose')).Types.ObjectId(), employeeId: null, role: 'Administrator' }),
  getCompanyProfile: async (_v: unknown, id: string) => (id === company.id ? { id, name: 'Frugal Gambler', domain: 'frugalgambler.club', subreddit: 'TheFrugalGambler', socialLinks: [] } : null),
}));

import { Job, JobRun } from '@/lib/models/Job';
import { PublishItem, PublishDelivery } from '@/lib/models/Publishing';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { IntegrationConnection } from '@/lib/models/Integration';
import User from '@/lib/models/User';
import { nextRotationItem, rotationView, runPublishing, takeBaseline, titleFromUrl, type PublishDeps } from './engine';
import { parseRotation, updatePublishingSettings } from './setup';
import { cadenceLabel, type PublishingConfig } from './config';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const companyId = new Types.ObjectId(company.id);
let userId: Types.ObjectId;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_rotation_test'));
  await Promise.all([Job.syncIndexes(), JobRun.syncIndexes(), PublishItem.syncIndexes(), PublishDelivery.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

const SLUGS = ['six-commandments', 'understanding-rtp', 'bankroll-basics', 'envelope-guide'];
const sitemap = () => `<urlset>${SLUGS.map((p) => `<url><loc>https://frugalgambler.club/news/${p}</loc></url>`).join('')}</urlset>`;
const fetcher = async (url: string) => {
  if (url === 'https://frugalgambler.club/sitemap.xml') return new Response(sitemap(), { status: 200 });
  const slug = /\/news\/([a-z0-9-]+)$/.exec(url)?.[1];
  if (slug && SLUGS.includes(slug)) return new Response(`<meta property="og:title" content="Guide ${slug}"><meta property="og:description" content="About ${slug}"><main>Text</main>`, { status: 200 });
  return new Response('missing', { status: 404 });
};

const base: PublishingConfig = {
  source: { type: 'site', feedUrl: 'https://frugalgambler.club/sitemap.xml', feedKind: 'sitemap', pathPrefix: '/news/', noun: 'article', rotation: { everyDays: 21 } },
  channels: [{ platform: 'facebook', mode: 'auto' }, { platform: 'reddit', mode: 'manual' }],
  examples: {},
  notifyUserIds: [],
  brief: 'Post one article every 3 weeks, in order',
};

let published: string[];
const deps = (): PublishDeps => ({
  fetcher,
  write: async ({ system }) => (system.includes('{"title"') ? JSON.stringify({ title: 'New Add: A guide', body: 'Reddit body' }) : JSON.stringify({ body: 'An evergreen guide.' })),
  send: async () => undefined,
  publish: { facebook: async (_c, input) => { published.push(input.link ?? ''); return { url: `https://www.facebook.com/1_${published.length}` }; } },
});

async function jobWith(config: PublishingConfig) {
  return Job.create({ organizationId: org, companyId, createdByUserId: userId, status: 'active', request: config.brief, publishing: { ...config, baselineAt: new Date() }, design: { skill: 'social_publish' } });
}
async function run(jobId: Types.ObjectId) {
  const doc = await JobRun.create({ organizationId: org, jobId, companyId, dryRun: false, status: 'running', startedAt: new Date(), leaseOwner: 'owner', leaseExpiresAt: new Date(Date.now() + 600_000), progressState: { stage: 'preparing', label: 'x', percent: 5, updatedAt: new Date() } });
  const job = await Job.findById(jobId).lean();
  await runPublishing(doc, 'owner', job as never, deps());
  return (await JobRun.findById(doc._id).lean())!;
}
const summaryOf = (r: { output?: unknown }) => (r.output as { summary: string }).summary;
/** Pretend the last post happened this many days ago. */
// (createdAt is immutable through the model, so this goes to the collection directly.)
const ageLastPost = (days: number) => PublishItem.collection.updateMany({ status: 'processed' }, { $set: { createdAt: new Date(Date.now() - days * 86_400_000) } });
const fresh = async (jobId: Types.ObjectId) => (await Job.findById(jobId).lean()) as never;

beforeEach(async () => {
  await Promise.all([Job.deleteMany({}), JobRun.deleteMany({}), PublishItem.deleteMany({}), PublishDelivery.deleteMany({}), BrandVoice.deleteMany({}), IntegrationConnection.deleteMany({}), User.deleteMany({})]);
  userId = (await User.create({ name: 'Ryan', email: 'ryan@example.com', organizationId: String(org), password: 'x'.repeat(20) }))._id as Types.ObjectId;
  await BrandVoice.create({ organizationId: org, companyId, persona: 'Cheeky and practical.', status: 'approved', updatedByUserId: userId });
  await IntegrationConnection.create({ organizationId: org, companyId, provider: 'facebook', scope: 'company', status: 'connected', source: 'manual' });
  published = [];
});

describe('evergreen rotation', () => {
  it('allows the randomized calendar-day window even when it is earlier than the previous clock time', async () => {
    const job = await jobWith(base);
    await Job.updateOne({ _id: job._id }, { $set: { 'design.schedule': { kind: 'daily', everyDays: 21, anchorDate: '2026-10-20', timezone: 'America/Chicago', randomWindow: { startHour: 9, endHour: 19 } } } });
    await PublishItem.create({ organizationId: org, companyId, jobId: job._id, key: 'old', title: 'Old article', status: 'processed', createdAt: new Date('2026-10-20T16:30:00Z') });
    const entries = [{ key: 'next', url: 'https://frugalgambler.club/news/next', title: 'Next', date: null }];
    expect(await nextRotationItem(job.toObject(), entries, { everyDays: 21 }, 1, 'article', new Date('2026-11-10T14:59:00Z'))).toHaveProperty('wait');
    expect(await nextRotationItem(job.toObject(), entries, { everyDays: 21 }, 1, 'article', new Date('2026-11-10T15:00:00Z'))).toHaveProperty('entry');
  });
  it('reads "one article every 3 weeks, in order" and leaves "post new games" alone', () => {
    expect(parseRotation('Post one article every 3 weeks, in order, to our socials and Reddit')).toEqual({ everyDays: 21 });
    expect(parseRotation('post an evergreen guide every other week')).toEqual({ everyDays: 14 });
    expect(parseRotation('share one guide every two weeks')).toEqual({ everyDays: 14 });
    expect(parseRotation('post our evergreen articles monthly')).toEqual({ everyDays: 30 });
    expect(parseRotation('post every new game to Facebook every day')).toBeNull();
    expect(parseRotation('post new games to Facebook')).toBeNull();
    expect(cadenceLabel(21)).toBe('3 weeks');
    expect(cadenceLabel(7)).toBe('week');
    expect(cadenceLabel(10)).toBe('10 days');
  });

  it('does not treat the existing library as already seen when switched on', async () => {
    const job = await jobWith(base);
    expect(await takeBaseline(job.toObject(), deps())).toBe(0);
    expect(await PublishItem.countDocuments()).toBe(0);
  });

  it('posts the oldest article first, waits out the cadence, then posts the next in order', async () => {
    const job = await jobWith(base);
    const first = await run(job._id);
    expect(first.status).toBe('completed');
    expect(summaryOf(first)).toMatch(/1 evergreen article/);
    expect(published).toEqual(['https://frugalgambler.club/news/six-commandments']);
    const reddit = await PublishDelivery.findOne({ platform: 'reddit' }).lean();
    expect(reddit?.title).toBe('New Article: A guide');

    const waiting = await run(job._id);
    expect(summaryOf(waiting)).toMatch(/next article is due \d{4}-\d{2}-\d{2}\. One article is posted every 3 weeks/);
    expect(published).toHaveLength(1);

    await ageLastPost(22);
    await run(job._id);
    expect(published[1]).toBe('https://frugalgambler.club/news/understanding-rtp');
  });

  it('posts a chosen list in its own order, never posts what was left out, and starts over at the end', async () => {
    const pool = [{ url: 'https://frugalgambler.club/news/bankroll-basics', title: 'Bankroll basics' }, { url: 'https://frugalgambler.club/news/six-commandments', title: '' }];
    const job = await jobWith({ ...base, source: { ...base.source, rotation: { everyDays: 7, pool } } as PublishingConfig['source'] });
    await run(job._id);
    await ageLastPost(8);
    await run(job._id);
    await ageLastPost(8);
    const third = await run(job._id);
    expect(published.slice(0, 2)).toEqual(['https://frugalgambler.club/news/bankroll-basics', 'https://frugalgambler.club/news/six-commandments']);
    expect(published[2]).toBe('https://frugalgambler.club/news/bankroll-basics');
    expect(summaryOf(third)).toMatch(/1 evergreen article/);
    expect(published).not.toContain('https://frugalgambler.club/news/understanding-rtp');
    expect((await Job.findById(job._id).lean())?.publishing).toMatchObject({ rotationCycle: 2 });
    expect(await PublishItem.countDocuments({ key: 'https://frugalgambler.club/news/bankroll-basics#2' })).toBe(1);
  });

  it('does nothing when the list has been emptied', async () => {
    const job = await jobWith({ ...base, source: { ...base.source, rotation: { everyDays: 7, pool: [] } } as PublishingConfig['source'] });
    await run(job._id);
    expect(published).toEqual([]);
    expect(await PublishItem.countDocuments()).toBe(0);
  });

  it('shows the list in posting order with what is posted, what is next, and what could be added', async () => {
    const job = await jobWith(base);
    let view = await rotationView(job.toObject(), deps());
    expect(view).toMatchObject({ everyDays: 21, cycle: 1, explicit: false, nextDue: null, problem: null, available: [] });
    expect(view!.pool.map((p) => p.url.split('/').pop())).toEqual(SLUGS);
    expect(view!.pool[0]).toMatchObject({ next: true, postedAt: null, title: 'Six commandments' });

    await run(job._id);
    view = await rotationView(await fresh(job._id), deps());
    expect(view!.pool[0]).toMatchObject({ next: false });
    expect(view!.pool[0]!.postedAt).toBeTruthy();
    expect(view!.pool[1]!.next).toBe(true);
    expect(view!.nextDue).toBeTruthy();

    await Job.updateOne({ _id: job._id }, { $set: { 'publishing.source.rotation.pool': [{ url: 'https://frugalgambler.club/news/envelope-guide', title: 'Envelopes' }] } });
    view = await rotationView(await fresh(job._id), deps());
    expect(view).toMatchObject({ explicit: true });
    expect(view!.pool).toHaveLength(1);
    expect(view!.available.map((a) => a.url.split('/').pop())).toEqual(['six-commandments', 'understanding-rtp', 'bankroll-basics']);
    expect(titleFromUrl('https://x.example/news/how-to-be-frugal')).toBe('How to be frugal');
  });

  it('lets a manager change how often, choose and order the pages, and go back to every page', async () => {
    const job = await jobWith(base);
    const viewer = { userId: String(userId), organizationId: org, employeeId: null, role: 'Manager' as const };
    const pool = async () => ((await Job.findById(job._id).lean()) as unknown as { publishing: { source: { rotation: { everyDays: number; pool?: { url: string; title: string }[] } } } }).publishing.source.rotation;

    expect(await updatePublishingSettings(viewer, job.toObject(), { rotation: { everyDays: 14 } })).toEqual({ ok: true });
    expect((await pool()).everyDays).toBe(14);

    const chosen = [{ url: 'https://www.frugalgambler.club/news/envelope-guide#top', title: ' Envelopes ' }, { url: 'https://frugalgambler.club/news/six-commandments' }, { url: 'https://frugalgambler.club/news/envelope-guide' }];
    expect(await updatePublishingSettings(viewer, await fresh(job._id), { rotation: { pool: chosen } })).toEqual({ ok: true });
    expect((await pool()).pool).toEqual([{ url: 'https://frugalgambler.club/news/envelope-guide', title: 'Envelopes' }, { url: 'https://frugalgambler.club/news/six-commandments', title: '' }]);

    expect(await updatePublishingSettings(viewer, await fresh(job._id), { rotation: { pool: [{ url: 'https://evil.example/news/x' }] } })).toMatchObject({ ok: false, status: 400 });
    expect(await updatePublishingSettings(viewer, await fresh(job._id), { rotation: { pool: [{ url: 'http://frugalgambler.club/news/x' }] } })).toMatchObject({ ok: false, status: 400 });
    expect(await updatePublishingSettings(viewer, await fresh(job._id), { rotation: { everyDays: 0 } })).toMatchObject({ ok: false, status: 400 });
    expect(await updatePublishingSettings({ ...viewer, role: 'User' }, await fresh(job._id), { rotation: { everyDays: 7 } })).toMatchObject({ ok: false, status: 403 });

    expect(await updatePublishingSettings(viewer, await fresh(job._id), { rotation: { pool: null } })).toEqual({ ok: true });
    expect((await pool()).pool).toBeUndefined();

    const plain = await Job.create({ organizationId: org, companyId, createdByUserId: userId, status: 'active', request: 'x', publishing: { ...base, source: { ...base.source, rotation: undefined } }, design: { skill: 'social_publish' } });
    expect(await updatePublishingSettings(viewer, plain.toObject(), { rotation: { everyDays: 7 } })).toMatchObject({ ok: false, status: 400 });
  });
});
