import { expect, it, vi } from 'vitest';
import { changedMethod, openScoutSources, planResearch, strategyBrief } from './researchStrategy';

const usable = { source: 'Bluesky profiles', discovery: 'Find company profiles', verification: 'Open their sites', pivot: 'Try company sites' };

it('keeps a plan whose text runs long, ending at a sentence', async () => {
  const ask = vi.fn().mockResolvedValue({ ...usable, discovery: 'Find company profiles on Bluesky. '.repeat(100) });
  const plan = await planResearch('Scout', '', ask);
  expect(ask).toHaveBeenCalledTimes(1);
  expect(plan.discovery.length).toBeLessThanOrEqual(2000);
  expect(plan.discovery.endsWith('.')).toBe(true);
});

it('accepts a plan written as a list of steps', async () => {
  const plan = await planResearch('Scout', '', vi.fn().mockResolvedValue({ ...usable, discovery: ['Find profiles.', 'Open their sites.'] }));
  expect(plan.discovery).toBe('Find profiles. Open their sites.');
});

it('asks once more, saying what was wrong, before giving up', async () => {
  const ask = vi.fn().mockResolvedValueOnce({ source: 'Bluesky profiles' }).mockResolvedValueOnce(usable);
  expect((await planResearch('Scout', '', ask)).discovery).toBe(usable.discovery);
  expect(ask).toHaveBeenCalledTimes(2);
  expect(ask.mock.calls[1]?.[1]).toContain('Problem: discovery');
});

it('reports which field failed and why after the second try', async () => {
  const ask = vi.fn().mockResolvedValue({ source: 'Bluesky profiles', discovery: { steps: 1 } });
  await expect(planResearch('Scout', '', ask)).rejects.toThrow('incomplete strategy: discovery:');
  expect(ask).toHaveBeenCalledTimes(2);
});

it('uses the declared pivot if the replan repeats the stalled search', () => {
  const method = { source: 'Launch listings', rationale: 'Find recent launches', discovery: 'Find founders', verification: 'Check company pages', pivot: 'Start with founder announcements on social' };
  expect(changedMethod(method, method).source).toBe(method.pivot);
});

it('deduplicates and bounds opened sources, retaining failures as unknown', async () => {
  const open = vi.fn(async (url: string) => {
    if (url.endsWith('/two')) throw new Error('blocked');
    return { url, title: 'Team', thin: false, links: ['https://example.org/contact'] };
  });
  const report = ['one', 'one#duplicate', 'two', 'three', 'four', 'five'].map(path => 'https://example.org/' + path).join(' ');
  const receipts = await openScoutSources(report, open);
  expect(open).toHaveBeenCalledTimes(4);
  expect(receipts[0]).toContain('/contact');
  expect(receipts[1]).toContain('evidence unknown');
});

it('completes a partial planner reply without another model call', async () => {
  const partial = { source: 'Launch directories', discovery: 'Collect founder announcements', rationale: 'Dated launches' };
  const ask = vi.fn().mockResolvedValue(partial);
  const defaults = vi.fn();
  const plan = await planResearch('Scout prospects', '', ask, defaults);
  expect(ask).toHaveBeenCalledTimes(1);
  expect(plan).toMatchObject(partial);
  expect(plan.verification).toContain('primary pages');
  expect(plan.pivot).toContain('unmet requirement');
  expect(defaults).toHaveBeenCalledWith(['verification', 'pivot']);
  await expect(planResearch('Scout prospects', '', async () => ({}))).rejects.toThrow('source');
});

it.each([undefined, null, '', {}, 'x'.repeat(501)])('dispatches a usable strategy with unusable rationale %j', async rationale => {
  const ask = vi.fn().mockResolvedValue({ source: 'Founder launches', discovery: 'Find dated announcements', rationale, family: 'startup sites' });
  const plan = await planResearch('Scout prospects', '', ask);
  expect(ask).toHaveBeenCalledTimes(1);
  expect(strategyBrief(plan)).toContain('Start at Founder launches.\nFind dated announcements');
  expect(plan.family).toBe('other');
});
