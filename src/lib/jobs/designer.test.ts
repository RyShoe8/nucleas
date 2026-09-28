import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

vi.mock('server-only', () => ({}));
const chat = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/companyChat', () => ({ attemptCompanyCredentialChat: (input: unknown) => chat(input) }));
vi.mock('@/lib/ai/engine/catalog', () => ({ listAvailableModels: async () => [] }));
vi.mock('@/lib/ai/engine/select', () => ({ selectModel: async () => ({ primary: { profileId: 'p'.repeat(24), model: 'openai/gpt-6-sol', free: false, label: 'OpenAI' }, fallback: null }) }));
vi.mock('@/lib/ai/company/companyTools', () => ({ buildAssistantTools: async () => ({ toolSet: { definitions: [], execute: vi.fn() }, invocationIds: [] }) }));
vi.mock('@/lib/companies/companyProfile', () => ({
  getCompanyProfile: async () => ({ id: 'c'.repeat(24), name: 'Playbound.club', relationship: 'owned', domain: 'playbound.club' }),
}));
vi.mock('@/lib/integrations/connections', () => ({ listCompanyConnections: async () => [{ status: 'connected', providerName: 'Google Analytics' }] }));
vi.mock('@/lib/building/companyCode', () => ({
  resolveCompanyRepository: async () => ({ projectId: new Types.ObjectId(), projectName: 'PlayBound', repository: { fullName: 'RyShoe8/playbound' } }),
}));
vi.mock('@/lib/companies/activityLog', () => ({ companyTimeline: async () => [], renderTimeline: () => '' }));
vi.mock('@/lib/ai/repo/snapshot', () => ({ getRepoSnapshot: async () => ({ ok: false, reason: 'test' }) }));

import { designerPrompt, designJob } from './designer';

const viewer = { userId: 'u'.repeat(24), organizationId: new Types.ObjectId(), employeeId: null, role: 'Administrator' as const };
const DESIGN = {
  title: 'Earn a dofollow backlink daily',
  category: 'outreach',
  instructions: 'Each day find one relevant, reputable site that links out with dofollow links and prepare a legitimate submission.',
  fields: [{ key: 'target_url', label: 'Target page', type: 'url', required: true }],
  delivery: { method: 'handoff', detail: 'A person sends the outreach.' },
  schedule: { kind: 'daily', time: '09:00' },
  questions: [{ id: 'sender', question: 'Which address should outreach come from?', options: [{ id: 'brevo', label: 'Brevo' }], recommended: 'brevo' }],
};

beforeEach(() => chat.mockReset());

describe('job designer', () => {
  it('carries the hard rules into every design', () => {
    const prompt = designerPrompt('2026-09-28');
    expect(prompt).toContain('Never propose giving Nucleas database credentials, environment variables');
    expect(prompt).toContain('choose the LOWEST that works');
    expect(prompt).toContain('verifies each request is signed by Nucleas with a public key committed in the repository');
    expect(prompt).toContain('no paid or exchanged links');
    expect(prompt).toContain('Investigate before asking');
  });

  it('investigates with repository, web and company tools, and returns the design with its questions', async () => {
    chat.mockResolvedValue({ requestId: 'r', role: 'assistant', text: `Here you go:\n\`\`\`json\n${JSON.stringify(DESIGN)}\n\`\`\``, costMicros: 2500 });
    const steps: string[] = [];
    const result = await designJob(viewer, { companyId: 'c'.repeat(24), request: 'Every day build a follow link for a PlayBound page', level: 'medium', onProgress: (t) => steps.push(t) });
    expect(result).toMatchObject({ ok: true, costMicros: 2500, design: { title: 'Earn a dofollow backlink daily', category: 'outreach', recordsPerRun: 1, recommendedCompletion: 'review', questions: [{ id: 'sender', recommended: 'brevo' }] } });
    const call = chat.mock.calls[0][0];
    expect(call).toMatchObject({ includeRepoTools: true, toolProfile: 'full', forceToolLoop: true, model: 'openai/gpt-6-sol' });
    expect(call.userText).toContain('Code repository: RyShoe8/playbound');
    expect(call.userText).toContain('Connected systems: Google Analytics');
    expect(steps).toContain('Designing the job with gpt-6-sol');
  });

  it('gives the answers back to the designer and recovers from a reply that is not a design', async () => {
    chat
      .mockResolvedValueOnce({ requestId: 'r', role: 'assistant', text: 'I think we should use outreach.', costMicros: 100 })
      .mockResolvedValueOnce({ requestId: 'r', role: 'assistant', text: JSON.stringify({ ...DESIGN, questions: [] }), costMicros: 50 });
    const result = await designJob(viewer, {
      companyId: 'c'.repeat(24),
      request: 'Every day build a follow link',
      level: 'low',
      answers: { sender: { option: 'brevo', text: 'use hello@playbound.club' } },
      previous: { questions: DESIGN.questions as never },
    });
    expect(result).toMatchObject({ ok: true, costMicros: 150, design: { questions: [] } });
    expect(chat.mock.calls[0][0].userText).toContain('Answer: Brevo — use hello@playbound.club');
    expect(chat.mock.calls[1][0]).toMatchObject({ toolProfile: 'none', forcePlain: true });
    expect(chat.mock.calls[1][0].userText).toContain('was not a valid design');
  });
});
