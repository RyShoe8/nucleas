import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/services/email', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai/engine/ask', () => ({
  askEngine: vi.fn(async ({ system }: { system: string }) => ({ text: system.includes('{"title"') ? '{"title":"New Game Release: Factorio","body":"Body"}' : '{"body":"Factorio is here."}', model: 'm', usedFallback: false })),
}));
vi.mock('@/lib/ai/engine/select', () => ({ readEngineSettings: async () => ({ defaultCostLevel: 'low' }), isCostLevel: () => true }));

import Client from '@/lib/models/Client';
import User from '@/lib/models/User';
import Employee from '@/lib/models/Employee';
import { Job, JobRun } from '@/lib/models/Job';
import { PublishDelivery, PublishItem } from '@/lib/models/Publishing';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { sealSecret } from '@/lib/security/secretBox';
import { sendEmail } from '@/lib/services/email';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { claimDueJobRuns, createPublishing, decideRun, executeJobRun, getJob, publishingAction } from '@/lib/jobs/jobs';
import { planRequest, type PublishPlan } from './setup';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
let admin: CompanyViewer;
let member: CompanyViewer;
let companyId: string;
let pages: string[];

const site = async (input: string | URL | Request) => {
  const url = String(input);
  if (url === 'https://playbound.club/sitemap.xml') return new Response(`<urlset>${pages.map((p) => `<url><loc>https://playbound.club/games/${p}</loc></url>`).join('')}<url><loc>https://playbound.club/about/team</loc></url></urlset>`, { status: 200 });
  const slug = /\/games\/([a-z0-9-]+)$/.exec(url)?.[1];
  if (slug && pages.includes(slug)) return new Response(`<meta property="og:title" content="${slug}"><main>About ${slug}</main>`, { status: 200 });
  return new Response('missing', { status: 404 });
};

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET ||= 'test-secret-for-sealing-integration-credentials';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_publishing_setup_test'));
  vi.stubGlobal('fetch', site);
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  vi.mocked(sendEmail).mockClear();
  await Promise.all([Client.deleteMany({}), User.deleteMany({}), Employee.collection.deleteMany({}), Job.deleteMany({}), JobRun.deleteMany({}), PublishItem.deleteMany({}), PublishDelivery.deleteMany({}), BrandVoice.deleteMany({}), IntegrationConnection.deleteMany({}), IntegrationSecret.deleteMany({})]);
  const user = await User.create({ name: 'Ryan Shoe', email: 'owner@example.invalid', password: 'synthetic-pass', organizationId: String(org) });
  await Employee.collection.insertOne({ userId: user._id, organizationId: String(org), role: 'Administrator', name: 'Owner', email: 'owner@example.invalid' });
  admin = { userId: String(user._id), organizationId: org, employeeId: null, role: 'Administrator' };
  // A team member assigned to PlayBound: sees its jobs and handles its cards, but cannot change settings.
  const teammate = new Types.ObjectId();
  member = { ...admin, employeeId: String(teammate), role: 'User' };
  const company = await Client.create({ organizationId: org, name: 'PlayBound', color: '#222', relationship: 'owned', domain: 'playbound.club', subreddit: 'PlayBoundGaming', assignedToEmployeeIds: [teammate] });
  companyId = String(company._id);
  const secret = await IntegrationSecret.create({ organizationId: org, provider: 'facebook', sealed: sealSecret('integration:facebook', 'page-token') });
  await IntegrationConnection.create({ organizationId: org, companyId: company._id, provider: 'facebook', scope: 'company', status: 'connected', source: 'manual', secretId: secret._id });
  pages = ['deus-ex', 'openra'];
});

const REQUEST = 'When a new game is published, post it to Facebook, Bluesky and Reddit';

async function confirmedPlan(): Promise<PublishPlan> {
  const planned = await planRequest(admin, { companyId, request: REQUEST });
  if (!planned.ok || planned.plan.kind !== 'social_publish') throw new Error('expected a publishing plan');
  return planned.plan as PublishPlan;
}

describe('setting up a publishing job', () => {
  it('turns one sentence into a plan: the section to watch, each platform’s mode, and what is missing', async () => {
    const plan = await confirmedPlan();
    expect(plan).toMatchObject({ title: 'Post new games to social', sourceLabel: 'Watching playbound.club/games/ for new games', newest: { url: 'https://playbound.club/games/openra' }, notifyUserIds: [admin.userId] });
    expect(plan.channels.map((c) => [c.platform, c.selected, c.mode])).toEqual([['facebook', true, 'auto'], ['bluesky', true, 'manual'], ['reddit', true, 'manual']]);
    expect(plan.channels[1]!.note).toContain('not connected');
    expect(plan.channels[2]!.note).toContain('r/PlayBoundGaming');
    expect(plan.blocker).toContain('Voice is not approved');
    expect(await planRequest(admin, { companyId, request: 'Research Deadlock and add it to the catalog' })).toEqual({ ok: true, plan: { kind: 'custom' } });
    await IntegrationSecret.deleteMany({});
    const broken = await confirmedPlan();
    expect(broken.channels[0]).toMatchObject({ platform: 'facebook', canAuto: false, mode: 'manual', note: expect.stringContaining('no usable Page token') });
    expect(await planRequest(member, { companyId, request: REQUEST })).toMatchObject({ ok: false, status: 403 });
  });

  it('runs a dry run, switches on hourly after it is accepted, and posts only later games', async () => {
    await BrandVoice.create({ organizationId: org, companyId: new Types.ObjectId(companyId), persona: 'Warm and nerdy.', status: 'approved', updatedByUserId: new Types.ObjectId(admin.userId) });
    const plan = await confirmedPlan();
    const created = await createPublishing(admin, { companyId, request: REQUEST, source: plan.source, channels: plan.channels.filter((c) => c.selected).map((c) => ({ platform: c.platform, mode: c.mode })), notifyUserIds: plan.notifyUserIds, examples: { reddit: 'Title: New Game Release: X\n\nWhat it is' } });
    if (!created.ok || !created.dryRunId) throw new Error(created.ok ? 'no dry run' : created.error);
    expect(created.job).toMatchObject({ status: 'testing', design: { skill: 'social_publish', schedule: { kind: 'hourly' } }, publishing: { channels: [{ platform: 'facebook', mode: 'auto' }, { platform: 'bluesky', mode: 'manual' }, { platform: 'reddit', mode: 'manual' }] } });

    await executeJobRun(created.dryRunId);
    expect(await JobRun.findById(created.dryRunId).lean()).toMatchObject({ status: 'needs_review' });
    expect(await createPublishing(admin, { companyId, request: REQUEST, source: plan.source, channels: [{ platform: 'reddit', mode: 'manual' }] })).toMatchObject({ ok: false, status: 409 });

    const accepted = await decideRun(admin, created.job.id, created.dryRunId, 'accept');
    expect(accepted).toMatchObject({ ok: true, job: { status: 'ready' } });
    if (!accepted.ok) return;
    expect(new Date(accepted.job.nextRunAt!).getTime() - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(await PublishItem.countDocuments({ status: 'baseline' })).toBe(2);

    pages.push('factorio');
    const [runId] = await claimDueJobRuns(new Date(Date.now() + 61 * 60_000));
    expect(runId).toBeTruthy();
    await executeJobRun(runId!);
    const ready = (await getJob(admin, created.job.id))!.publishing!.ready;
    // Facebook refused the automatic post (the stubbed Graph API answers 404), so it became a card too.
    expect(ready.map((d) => d.platform).sort()).toEqual(['bluesky', 'facebook', 'reddit']);
    expect(ready.find((d) => d.platform === 'reddit')).toMatchObject({ title: 'New Game Release: Factorio', itemTitle: 'factorio' });
    expect(vi.mocked(sendEmail).mock.calls.at(-1)?.[0]).toMatchObject({ to: 'owner@example.invalid', subject: '3 posts ready to post · PlayBound' });

    // Anyone on the team can post a card by hand; only managers change the settings.
    const reddit = ready.find((d) => d.platform === 'reddit')!;
    expect(await publishingAction(member, created.job.id, 'mark_posted', { deliveryId: reddit.id })).toMatchObject({ ok: true });
    expect(await publishingAction(member, created.job.id, 'publishing_settings', { settings: { channels: [{ platform: 'reddit', mode: 'manual' }] } })).toMatchObject({ ok: false, status: 403 });
    const changed = await publishingAction(admin, created.job.id, 'publishing_settings', { settings: { channels: [{ platform: 'reddit', mode: 'auto' }, { platform: 'bluesky', mode: 'auto' }] } });
    expect(changed).toMatchObject({ ok: true, job: { publishing: { channels: [{ platform: 'bluesky', mode: 'auto' }, { platform: 'reddit', mode: 'manual' }] } } });
  });

  it('asks for pasted text when an example link cannot be read', async () => {
    const plan = await confirmedPlan();
    const result = await createPublishing(admin, { companyId, request: REQUEST, source: plan.source, channels: [{ platform: 'facebook', mode: 'auto' }], examples: { facebook: 'https://www.facebook.com/share/p/197tsmQiEU/' } });
    expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('Paste the post text') });
  });
});
