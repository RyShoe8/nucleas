import { describe, expect, it, vi } from 'vitest';
import { followUpRounds, gapCheckPrompt, gapCheckRequest, jobMethod, readGapCheck, recordLinks, runJobMethod, withoutGoneLinks } from './standard';

describe('reading a gap check', () => {
  it('reads the tasks, and caps how many it takes', () => {
    const missing = [1, 2, 3, 4, 5].map((n) => ({ task: `Open page number ${n}` }));
    const check = readGapCheck(JSON.stringify({ complete: false, missing, note: 'the list' }));
    expect(check).toMatchObject({ readable: true, note: 'the list' });
    expect(check.tasks).toHaveLength(3);
  });

  it('has no tasks once complete, even if the model listed some', () => {
    expect(readGapCheck('{"complete":true,"missing":[{"task":"Open another page"}]}').tasks).toEqual([]);
  });

  it('says so when the reply cannot be read', () => {
    expect(readGapCheck('not json')).toEqual({ readable: false, tasks: [], note: '' });
  });

  it('gives the checker what counts and what has been tried, and the newest findings', () => {
    const request = gapCheckRequest({ asked: 'List sites', whatCounts: 'Publications only', tried: ['Open the sitemap'], findings: `${'old '.repeat(10_000)}newest` });
    expect(request).toContain('# What counts\nPublications only');
    expect(request).toContain('- Open the sitemap');
    expect(request).toContain('newest');
    expect(request.length).toBeLessThan(21_000);
    expect(gapCheckPrompt('2026-11-06')).toContain('What counts');
  });
});

describe('following up on gaps', () => {
  it('works through tasks and stops when nothing is missing', async () => {
    const follow = vi.fn(async (_task: string) => undefined);
    const check = vi.fn<(tried: string[]) => Promise<{ readable: boolean; tasks: string[]; note: string }>>()
      .mockResolvedValueOnce({ readable: true, tasks: ['One', 'Two'], note: '' })
      .mockResolvedValueOnce({ readable: true, tasks: [], note: '' });
    await followUpRounds({ check, follow, stop: () => false });
    expect(follow.mock.calls.map((call) => call[0])).toEqual(['One', 'Two']);
    expect(check.mock.calls[1]?.[0]).toEqual(['One', 'Two']);
  });

  it('stops after the last round even if something is still missing', async () => {
    const follow = vi.fn(async (_task: string) => undefined);
    await followUpRounds({ maxRounds: 2, check: async () => ({ readable: true, tasks: ['Again'], note: '' }), follow, stop: () => false });
    expect(follow).toHaveBeenCalledTimes(2);
  });

  it('starts nothing new once the budget is used', async () => {
    const follow = vi.fn(async (_task: string) => undefined);
    let spent = 0;
    await followUpRounds({ check: async () => ({ readable: true, tasks: ['One', 'Two'], note: '' }), follow: async (task) => { spent += 1; await follow(task); }, stop: () => spent >= 1 });
    expect(follow).toHaveBeenCalledTimes(1);
  });
});

describe('links in job records', () => {
  const output = {
    records: [{ values: { site: 'https://real.com/', note: 'See [this](https://gone.com/page)', count: 3 }, sources: ['https://real.com/', 'https://gone.com/source', 'https://blocked.com/'] }],
    gaps: ['Something else'],
  };
  const checks = [
    { url: 'https://real.com/', status: 'opened' as const },
    { url: 'https://gone.com/page/', status: 'gone' as const },
    { url: 'https://gone.com/source', status: 'gone' as const },
    { url: 'https://blocked.com/', status: 'blocked' as const },
  ];

  it('finds every address in values and sources', () => {
    expect(recordLinks(output)).toEqual(['https://real.com/', 'https://gone.com/source', 'https://blocked.com/', 'https://real.com/', 'https://gone.com/page']);
  });

  it('removes missing sources and flags missing values, and never counts blocked against a record', () => {
    const result = withoutGoneLinks(output, checks);
    expect(result.output.records[0]?.sources).toEqual(['https://real.com/', 'https://blocked.com/']);
    expect(result.problems).toEqual([{ record: 0, field: 'note', problem: expect.stringContaining('https://gone.com/page does not exist') }]);
    expect(result.output.gaps).toEqual(['Something else', 'Removed sources that do not exist: https://gone.com/source']);
  });

  it('changes nothing when nothing is gone', () => {
    const result = withoutGoneLinks(output, [{ url: 'https://real.com/', status: 'opened' }]);
    expect(result.output).toBe(output);
    expect(result.problems).toEqual([]);
  });
});

describe('which jobs use the method', () => {
  it('is on for every job unless it is named as an exception', () => {
    for (const skill of ['link_building', 'casino_discovery', 'marketing_plan', 'seo_brief', 'brand_voice', 'ai_citations', 'some_future_job', undefined, null]) expect(jobMethod(skill)).toBe('full');
    expect(jobMethod('social_publish')).toBe('none');
    expect(jobMethod('signature_outreach')).toBe('own_pipeline');
  });
});

describe('running the method over a job', () => {
  type Output = { records: { values: Record<string, unknown>; sources: string[] }[]; gaps: string[]; label?: string };
  const start = (): Output => ({ records: [{ values: { site: 'https://a.com/' }, sources: ['https://a.com/'] }], gaps: [], label: 'first' });
  const harness = (overrides: Partial<Parameters<typeof runJobMethod<Output, { problem: string }>>[0]> = {}) => {
    let output = start();
    const input = {
      output: () => output,
      setOutput: (next: Output) => { output = next; },
      problems: [] as { problem: string }[],
      validate: () => [] as { problem: string }[],
      openPages: async (urls: string[]) => urls.map((url) => ({ url, status: 'opened' as const })),
      checkGaps: vi.fn(async () => ({ readable: true, tasks: [] as string[], note: '' })),
      research: vi.fn(async (): Promise<Output | null> => null),
      stop: () => false,
      ...overrides,
    };
    return { input, current: () => output };
  };
  const better = (): Output => ({ records: [{ values: { site: 'https://b.com/' }, sources: ['https://b.com/'] }], gaps: [], label: 'better' });
  const oneGap = () => vi.fn<(tried: string[], findings: string) => Promise<{ readable: boolean; tasks: string[]; note: string }>>().mockResolvedValueOnce({ readable: true, tasks: ['Find more'], note: '' }).mockResolvedValue({ readable: true, tasks: [], note: '' });

  it('opens links first, so the gap check sees what is really there', async () => {
    const checkGaps = vi.fn(async (_tried: string[], findings: string) => {
      expect(findings).toContain('OPENED https://a.com/');
      return { readable: true, tasks: [], note: '' };
    });
    const { input } = harness({ checkGaps });
    const result = await runJobMethod(input);
    expect(result.pages.map((page) => page.url)).toEqual(['https://a.com/']);
    expect(checkGaps).toHaveBeenCalledTimes(1);
  });

  it('keeps a follow-up that holds up, and opens its new links', async () => {
    const { input, current } = harness({ checkGaps: oneGap(), research: vi.fn(async () => better()) });
    const result = await runJobMethod(input);
    expect(current().label).toBe('better');
    expect(result.pages.map((page) => page.url)).toEqual(['https://a.com/', 'https://b.com/']);
  });

  it('puts the old result back when a follow-up makes it worse', async () => {
    const worse = [{ problem: 'Broken' }];
    let calls = 0;
    const { input, current } = harness({ checkGaps: oneGap(), research: vi.fn(async () => better()), validate: () => (calls++ === 0 ? worse : []) });
    const result = await runJobMethod(input);
    expect(current().label).toBe('first');
    expect(result.problems).toEqual([]);
  });

  it('ignores a follow-up with nothing usable', async () => {
    const { input, current } = harness({ checkGaps: oneGap() });
    await runJobMethod(input);
    expect(current().label).toBe('first');
  });

  it('still opens links when it may not spend any more', async () => {
    const { input } = harness({ stop: () => true });
    const result = await runJobMethod(input);
    expect(result.pages).toHaveLength(1);
    expect(input.checkGaps).not.toHaveBeenCalled();
  });

  it('reports a value that points at a missing page', async () => {
    const { input } = harness({ openPages: async (urls: string[]) => urls.map((url) => ({ url, status: 'gone' as const })) });
    const result = await runJobMethod(input);
    expect(result.linkProblems[0]?.problem).toContain('does not exist');
  });
});
