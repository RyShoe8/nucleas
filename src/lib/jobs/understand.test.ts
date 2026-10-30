import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const company = vi.hoisted(() => ({ id: 'c'.repeat(24) }));
vi.mock('@/lib/companies/companyProfile', () => ({
  isCompanyManager: () => true,
  getCompanyProfile: async (_v: unknown, id: string) => (id === company.id ? { id, name: 'Frugal Gambler', relationship: 'owned', domain: 'frugalgambler.club', socialLinks: [{ network: 'facebook', url: 'x' }], stackToolIds: [], urls: [], teamEmployeeIds: [], profileSource: 'client' } : null),
}));
vi.mock('@/lib/companies/upstreamContext', () => ({ upstreamContext: async () => 'Approved Marketing Plan:\n- Positioning: honest casino deal hunting' }));
vi.mock('@/lib/companies/adminAccount', () => ({ getAdminAccount: async () => null }));
vi.mock('@/lib/integrations/connections', () => ({ listCompanyConnections: async () => [{ provider: 'adsense', providerName: 'Google AdSense', status: 'connected' }] }));
vi.mock('./marketingPlans', () => ({ approvedMarketingPlan: async () => null }));
vi.mock('@/lib/models/BrandVoice', () => ({ BrandVoice: { exists: async () => ({ _id: 'v' }) } }));
vi.mock('@/lib/models/Watch', () => ({ ContentWatch: { find: () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) }) } }));
vi.mock('@/lib/ai/engine/ask', () => ({ askEngine: async () => null }));
vi.mock('@/lib/publishing/setup', () => ({ recognizeRequest: (t: string) => (/facebook/i.test(t) && /post/i.test(t) ? 'social_publish' : 'custom') }));

import { checkedNeeds, fallbackUnderstanding, understandRequest, understandingSchema } from './understand';

const viewer = { userId: 'u'.repeat(24), organizationId: 'o'.repeat(24), employeeId: null, role: 'Manager' as const } as never;
const reply = (o: Record<string, unknown>) => async () => JSON.stringify({ kind: 'custom', summary: 'A weekly report.', confidence: 0.9, brief: 'Every Monday, report ad revenue.', needs: [], questions: [], ...o });

describe('understanding a job request', () => {
  it('trusts the model over misleading words, and shows it the company and its upstream plans', async () => {
    let seen = '';
    const ask = async ({ user }: { system: string; user: string }) => {
      seen = user;
      return reply({ kind: 'custom', summary: 'A post-mortem report on last month’s Facebook ads, kept in Nucleas.' })();
    };
    const result = await understandRequest(viewer, { companyId: company.id, request: 'Write a post-mortem on our Facebook ads last month' }, ask);
    expect(result).toMatchObject({ ok: true, understanding: { kind: 'custom', understood: true, kindLabel: 'A custom job Nucleas designs' } });
    expect(seen).toContain('honest casino deal hunting');
    expect(seen).toContain('Connected systems: Google AdSense');
    expect(seen).toMatch(/not connected: .*Google Analytics/);
    expect(seen).toContain('Admin account: not connected');
  });

  it('adds the needs Nucleas can check itself, and corrects the model about them', async () => {
    const ask = reply({ kind: 'admin_publish', summary: 'Add new deals from the inbox to the admin.', brief: 'Add the best deals from our inbox to the admin.', needs: [{ label: 'Admin account', status: 'ready', detail: 'fine' }, { label: 'Deal fields', status: 'ready', detail: 'casino, offer' }] });
    const result = await understandRequest(viewer, { companyId: company.id, request: 'Add the best deals from our email to the admin' }, ask);
    if (!result.ok) throw new Error('setup');
    expect(result.understanding.needs).toEqual([
      { label: 'Admin account', status: 'action', detail: expect.stringContaining('Company → Admin account') },
      { label: 'Inbox watch', status: 'action', detail: expect.stringContaining('Inboxes') },
      { label: 'Deal fields', status: 'ready', detail: 'casino, offer' },
    ]);
  });

  it('never asks an answered question again', async () => {
    const ask = reply({ questions: [{ id: 'cadence', question: 'How often?', why: 'w', options: [{ id: 'weekly', label: 'Weekly' }, { id: 'daily', label: 'Daily' }] }, { id: 'recipients', question: 'Who receives it?', why: 'w', options: [{ id: 'me', label: 'Me' }, { id: 'clients', label: 'Clients' }] }] });
    const result = await understandRequest(viewer, { companyId: company.id, request: 'Report our ad revenue for clients', answers: { cadence: { option: 'weekly' } } }, ask);
    if (!result.ok) throw new Error('setup');
    expect(result.understanding.questions.map((q) => q.id)).toEqual(['recipients']);
  });

  it('falls back to the wording, marked as a guess, when no model answers or the reply is unusable', async () => {
    expect(await understandRequest(viewer, { companyId: company.id, request: 'Post our new games to Facebook' }, async () => null)).toMatchObject({ ok: true, understanding: { kind: 'social_publish', understood: false, confidence: 0.3 } });
    expect(await understandRequest(viewer, { companyId: company.id, request: 'Post our new games to Facebook' }, async () => 'I think you want to post things.')).toMatchObject({ ok: true, understanding: { understood: false } });
    expect(fallbackUnderstanding('Research competitors')).toMatchObject({ kind: 'custom', brief: 'Research competitors' });
  });

  it('refuses unknown companies and empty requests', async () => {
    expect(await understandRequest(viewer, { companyId: 'd'.repeat(24), request: 'Research competitors' })).toMatchObject({ ok: false, status: 404 });
    expect(await understandRequest(viewer, { companyId: company.id, request: 'hi' })).toMatchObject({ ok: false, status: 400 });
  });

  it('bounds what the model returns', () => {
    const parsed = understandingSchema.parse({ kind: 'teleport', summary: 'Something.', confidence: 7, brief: 'Do it.', needs: [{ label: 'X', status: 'odd' }], questions: [{ id: 'q', question: 'Which?', options: [{ id: 'a', label: 'A' }] }] });
    expect(parsed.kind).toBe('custom');
    expect(parsed.confidence).toBe(0.5);
    expect(parsed.needs[0]).toMatchObject({ status: 'action', detail: '' });
    expect(parsed.questions).toEqual([]);
  });

  it('checks digests and link building against what they depend on', () => {
    const facts = { hasDomain: true, voiceApproved: false, hasAdmin: true, watchCount: 1, planApproved: false };
    expect(checkedNeeds('digest', facts, 'weekly newsletter').map((n) => [n.label, n.status])).toEqual([['Brand Voice', 'action'], ['Inbox watch', 'ready']]);
    expect(checkedNeeds('link_building', facts, 'backlinks').map((n) => [n.label, n.status])).toEqual([['Marketing Plan', 'action']]);
    expect(checkedNeeds('custom', facts, 'anything')).toEqual([]);
  });
});

it('includes an already uploaded image when understanding and revising a publishing request', async () => {
  const prompts: string[] = [];
  const ask = async ({ user }: { system: string; user: string }) => {
    prompts.push(user);
    return reply({ kind: 'social_publish' })();
  };
  const input = { companyId: company.id, request: 'Post Game Nights This Week to Facebook', attachedImage: { alt: 'Game Nights weekly graphic' } };
  await understandRequest(viewer, input, ask);
  await understandRequest(viewer, { ...input, answers: { cadence: { text: 'Monday' } } }, ask);
  expect(prompts).toHaveLength(2);
  for (const prompt of prompts) {
    expect(prompt).toContain('already been uploaded');
    expect(prompt).toContain('Game Nights weekly graphic');
    expect(prompt).toContain('Do not ask for another upload');
  }
});
