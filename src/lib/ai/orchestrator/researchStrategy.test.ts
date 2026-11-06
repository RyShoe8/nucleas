import { expect, it, vi } from 'vitest';
import { changedMethod, openScoutSources } from './researchStrategy';

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
