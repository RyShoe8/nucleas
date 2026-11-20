import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/hooks/os/useWindowManager', () => ({ useWindowManager: () => ({ open: () => {} }) }));
vi.mock('../CompanyTeamPanel', () => ({ LiveExchange: () => null }));
import type { JobView } from './JobCard';
import WorkBoard, { JobPanel } from './WorkBoard';
import { jobLine, memberOf, modeLine, queueFor } from './workQueue';

const id = (c: string) => c.repeat(24);
const job = (overrides: Record<string, unknown> = {}) => ({
  id: id('a'), companyId: id('b'), companyName: 'PlayBound', status: 'active', request: 'Post new games', canManage: true, runs: [], opportunities: [], publishing: null,
  updatedAt: '2026-11-10T00:00:00Z', createdAt: '2026-11-01T00:00:00Z', lastRunAt: null, nextRunAt: null, completion: 'review', spentThisMonthMicros: 0, teamRole: 'marketing',
  design: { skill: 'link_building', title: 'Link building', category: 'marketing', fields: [], questions: [], schedule: { kind: 'daily', time: '09:00' } },
  ...overrides,
}) as unknown as JobView;
const delivery = (overrides: Record<string, unknown> = {}) => ({ id: id('d'), platform: 'reddit', status: 'ready', itemTitle: 'Factorio', title: 'New Game: Factorio', body: 'Build factories', link: null, assets: [], postedUrl: null, postedAt: null, error: null, createdAt: '2026-11-12T00:00:00Z', fields: null, screenshot: null, ...overrides });
const publishing = (ready: unknown[]) => ({ channels: [{ platform: 'facebook', mode: 'auto' }, { platform: 'bluesky', mode: 'auto' }, { platform: 'reddit', mode: 'manual' }], notifyUserIds: [], examples: {}, source: { type: 'site' }, notes: {}, admin: null, ready, recent: [], postedThisWeek: 0 });

describe('what a job needs from a person', () => {
  it('lists each waiting post, naming what follows the Reddit post', () => {
    const items = queueFor(job({ publishing: publishing([delivery({ following: [delivery({ id: id('e'), platform: 'facebook' }), delivery({ id: id('f'), platform: 'bluesky' })] })]) }));
    expect(items.map((i) => i.label)).toEqual(['Post “Factorio” to Reddit, then Facebook and Bluesky follow']);
    expect(items[0]?.target).toEqual({ kind: 'delivery', id: id('d') });
  });

  it('counts questions, plans, results to review and link opportunities, oldest first', () => {
    expect(queueFor(job({ status: 'needs_answers', design: { ...job().design, questions: [{}, {}] } }))[0]?.label).toBe('Answer 2 questions so the plan can be finished');
    expect(queueFor(job({ status: 'proposed' }))[0]?.label).toBe('Approve the plan, or reject it');
    const items = queueFor(job({
      runs: [{ id: 'r1', status: 'needs_review', dryRun: false, startedAt: '2026-11-11T00:00:00Z', finishedAt: '2026-11-11T01:00:00Z' }],
      opportunities: [{ id: 'o1', status: 'recommended', values: { opportunity_type: 'Resource page' }, updatedAt: '2026-11-09T00:00:00Z' }, { id: 'o2', status: 'submitted', values: {}, updatedAt: '2026-11-09T00:00:00Z' }],
    }));
    expect(items.map((i) => i.label)).toEqual(['Approve or skip a link opportunity: Resource page', 'Review a finished result']);
  });

  it('needs nothing from a quiet job', () => {
    expect(queueFor(job())).toEqual([]);
  });
});

describe('a job row in a few words', () => {
  it('says how results go out', () => {
    expect(modeLine(job({ publishing: publishing([]) }))).toBe('Facebook, Bluesky automatic · Reddit waits for you');
    expect(modeLine(job({ completion: 'automatic' }))).toBe('Results count automatically when every check passes');
  });
  it('says what it is doing', () => {
    expect(jobLine(job({ status: 'paused' }), 'Every day at 09:00')).toBe('Paused · Every day at 09:00');
    expect(jobLine(job({ runs: [{ id: 'r', status: 'running', progressState: { label: 'Reading sites' } }] }), 'x')).toBe('Working now · Reading sites');
  });
  it('belongs to its team member', () => {
    expect(memberOf(job({ teamRole: 'engineering' }))).toBe('engineering');
  });
});

describe('the Work board', () => {
  const render = (jobs: JobView[]) => renderToStaticMarkup(createElement(WorkBoard, { jobs, activity: [], names: new Map([[id('b'), 'PlayBound']]), selected: 'all', createdId: null, onChange: () => {} }));

  it('puts what needs you first, with who it is for, then the company opened to that member', () => {
    const html = render([job({ publishing: publishing([delivery()]), design: { ...job().design, skill: 'social_publish', title: 'New game posts', schedule: { kind: 'hourly' } } }), job({ id: id('c'), design: { ...job().design, title: 'Evergreen posts' } })]);
    expect(html.indexOf('Needs you')).toBeLessThan(html.indexOf('New game posts'));
    expect(html).toContain('Post “Factorio” to Reddit');
    expect(html).toContain('PlayBound · Marketing · New game posts');
    expect(html).toContain('1 waiting');
    expect(html).toContain('Evergreen posts');
  });

  it('says so when nothing needs you, and keeps quiet companies folded', () => {
    const html = render([job()]);
    expect(html).toContain('Nothing needs you right now.');
    expect(html).toContain('PlayBound');
    expect(html).not.toContain('Link building');
  });

  it('opens a publishing warning from its run notification and lets a manager resolve it', () => {
    const run = (id: string, summary: string) => ({ id, status: 'needs_review', dryRun: false, startedAt: '2026-11-20T00:00:00Z', issues: [], output: { records: [], gaps: [summary], summary } });
    const current = job({ publishing: publishing([]), design: { ...job().design, skill: 'social_publish' }, runs: [run('newer', 'A newer warning'), run('older', 'Six pages skipped after a site change')] });
    const html = renderToStaticMarkup(createElement(JobPanel, { job: current, focus: { kind: 'run', id: 'older' }, onChange: () => {} }));
    expect(html).toContain('Six pages skipped after a site change');
    expect(html).not.toContain('A newer warning');
    expect(html).toContain('View full results');
    expect(html).toContain('>Accept<');
    expect(html).toContain('>Reject<');
  });
});
