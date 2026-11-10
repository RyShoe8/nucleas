import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

vi.mock('server-only', () => ({}));
const engine = vi.fn();
const chat = vi.fn();
vi.mock('@/lib/ai/engine/ask', () => ({ askEngine: (input: unknown) => engine(input) }));
vi.mock('@/lib/ai/companyChat', () => ({ attemptCompanyCredentialChat: (input: unknown) => chat(input) }));
vi.mock('@/lib/ai/engine/select', () => ({
  readEngineSettings: async () => ({}),
  selectModel: async (_org: string, need: string, level: string) => ({ primary: { model: `${level}-${need}`, profileId: 'p', free: level === 'free' }, fallback: null }),
}));
vi.mock('@/lib/models/CompanyTeam', () => ({
  CompanyTeam: { find: () => ({ select: () => ({ lean: async () => [{ role: 'design', remit: 'Own the checkout experience.', lessons: 'Never hide the price.' }] }) }) },
}));
vi.mock('@/lib/context/resolveCompanyContext', () => ({
  resolveCompanyContext: async () => ({ sections: [{ key: 'company', title: 'Company', body: 'Name: Frugal Gambler' }, { key: 'activity', title: 'Recent changes', body: 'noise' }] }),
  renderContext: (ctx: { sections: { title: string; body: string }[] }) => ctx.sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n'),
}));
vi.mock('@/lib/jobs/marketingPlans', () => ({ approvedMarketingPlan: async () => ({ plan: true }), marketingPlanContext: () => '{"audience":"value-seeking players"}' }));

import { askMembers, consultTeammates, renderAdvice, teamAdviceForJob, validConsults } from './teamConsult';

const viewer = { organizationId: new Types.ObjectId(), userId: String(new Types.ObjectId()) } as never;
const companyId = String(new Types.ObjectId());
type EngineInput = { need: string; system: string; user: string };
type ChatInput = { model: string; toolProfile: string; forceToolLoop: boolean; userText: string; systemPrompt: string };

beforeEach(() => {
  engine.mockReset();
  chat.mockReset();
  chat.mockResolvedValue({ role: 'assistant', text: 'Findings\n- Rivals show the price first ([Baymard](https://baymard.com/checkout)).' });
});

describe('choosing teammates to ask', () => {
  it('keeps real teammates only, never the asker, the reserved tester or the same member twice', () => {
    const raw = { consult: [
      { member: 'marketing', question: 'Should I ask myself this?' },
      { member: 'tester', question: 'Can the tester check this?' },
      { member: 'design', question: 'Where should the price sit?' },
      { member: 'design', question: 'And again, where should it sit?' },
      { member: 'engineering', question: 'Is the checkout cached?' },
      { member: 'support', question: 'What do customers complain about?' },
    ] };
    expect(validConsults(raw, 'marketing')).toEqual([{ member: 'design', question: 'Where should the price sit?' }, { member: 'engineering', question: 'Is the checkout cached?' }]);
    expect(validConsults({ consult: [{ member: 'nobody', question: 'A made-up member?' }] }, 'marketing')).toEqual([]);
    expect(validConsults('not json', 'marketing')).toEqual([]);
  });
});

describe('a member answering with an intern', () => {
  it('sends a free model to browse first, then answers with those findings, the company and its marketing plan', async () => {
    engine.mockResolvedValue({ text: 'Put the price above the button.', model: 'paid-plan', usedFallback: false });
    const [answer] = await askMembers(viewer, companyId, [{ member: 'design', question: 'Where should the price sit?' }], 'Redesigning checkout.');

    const intern = chat.mock.calls[0][0] as ChatInput;
    expect(intern).toMatchObject({ model: 'free-research', toolProfile: 'full', forceToolLoop: true });
    expect(intern.userText).toContain('Where should the price sit?');
    expect(intern.userText).toContain('Frugal Gambler');

    const member = engine.mock.calls[0][0] as EngineInput;
    expect(member.need).toBe('plan');
    expect(member.system).toContain('Own the checkout experience.');
    expect(member.system).toContain('Never hide the price.');
    expect(member.user).toContain('Rivals show the price first');
    expect(member.user).toContain('Name: Frugal Gambler');
    expect(member.user).toContain('value-seeking players');
    expect(member.user).not.toContain('noise');

    expect(answer).toMatchObject({ member: 'design', advice: 'Put the price above the button.', researchModel: 'free-research', sources: ['https://baymard.com/checkout'] });
  });

  it('still answers, and says the search failed, when the intern comes back with nothing', async () => {
    chat.mockResolvedValue({ role: 'status', text: 'research failed' });
    engine.mockResolvedValue({ text: 'Check rivals before deciding.', model: 'paid-plan', usedFallback: false });
    const [answer] = await askMembers(viewer, companyId, [{ member: 'design', question: 'Where should the price sit?' }], 'Redesigning checkout.');
    expect((engine.mock.calls[0][0] as EngineInput).user).toContain('could not complete the search');
    expect(answer.sources).toBeUndefined();
  });
});

describe('the owner asking teammates', () => {
  it('asks only who the owner names, and nobody when the owner needs no one', async () => {
    engine.mockResolvedValueOnce({ text: '{"consult":[{"member":"design","question":"Where should the price sit?"}]}', model: 'paid-plan', usedFallback: false })
      .mockResolvedValueOnce({ text: 'Above the button.', model: 'paid-plan', usedFallback: false });
    const asked = await consultTeammates(viewer, companyId, 'marketing', 'Launch a checkout promotion.');
    expect(asked.map((item) => item.member)).toEqual(['design']);
    expect(renderAdvice(asked)).toContain('Design, asked: Where should the price sit?');

    engine.mockReset();
    chat.mockClear();
    engine.mockResolvedValueOnce({ text: '{"consult":[]}', model: 'paid-plan', usedFallback: false });
    expect(await consultTeammates(viewer, companyId, 'marketing', 'Post the weekly deal.')).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
    expect(renderAdvice([])).toBe('');
  });

  it('asks once per responsibility and reuses the answers on later runs', async () => {
    const save = vi.fn(async () => undefined);
    const job = { _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyId), request: 'Launch a checkout promotion.' };
    engine.mockResolvedValueOnce({ text: '{"consult":[]}', model: 'paid-plan', usedFallback: false });
    expect(await teamAdviceForJob(job, viewer, { save })).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);

    engine.mockReset();
    const kept = [{ member: 'design' as const, question: 'q', advice: 'a', model: 'm' }];
    expect(await teamAdviceForJob({ ...job, teamAdvice: { at: new Date(), items: kept } }, viewer, { save })).toEqual(kept);
    expect(engine).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('lets the work go ahead without advice when asking fails', async () => {
    engine.mockRejectedValue(new Error('down'));
    const save = vi.fn(async () => undefined);
    expect(await teamAdviceForJob({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyId), request: 'Anything at all.' }, viewer, { save })).toEqual([]);
  });
});
