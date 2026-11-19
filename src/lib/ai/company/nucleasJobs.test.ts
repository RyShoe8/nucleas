import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { summarizeJobs } from './companyTools';
import type { JobView } from '@/lib/jobs/jobs';

const job = (overrides: Record<string, unknown> = {}) => ({
  id: 'a', companyId: 'c1', companyName: 'PlayBound', status: 'active', request: 'Post each new game', teamRole: 'marketing', runs: [], opportunities: [], publishing: null,
  completion: 'review', lastRunAt: '2026-11-18T15:00:00.000Z', nextRunAt: '2026-11-18T16:00:00.000Z', spentThisMonthMicros: 420_000,
  design: { title: 'New game posts', schedule: { kind: 'hourly' } },
  ...overrides,
}) as unknown as JobView;

describe("Nucleas's own jobs, for Ask", () => {
  it('groups every job by company with its owner, status, schedule, runs, what waits for you and spend', () => {
    const groups = summarizeJobs([
      job({ publishing: { channels: [{ platform: 'facebook', mode: 'auto' }, { platform: 'reddit', mode: 'manual' }], ready: [{ status: 'ready' }, { status: 'ready' }] } }),
      job({ id: 'b', companyName: 'Frugal Gambler', teamRole: 'operations', status: 'paused', design: { title: 'Spend check', schedule: { kind: 'daily', time: '09:00' } }, runs: [{ status: 'needs_review' }] }),
      job({ id: 'c', status: 'proposed', design: { title: 'Link building', schedule: { kind: 'daily', everyDays: 3 } }, opportunities: [{ status: 'recommended' }] }),
    ]);
    expect(groups.map((g) => [g.company, g.count])).toEqual([['Frugal Gambler', 1], ['PlayBound', 2]]);
    const posts = groups[1].jobs[0];
    expect(posts).toMatchObject({ name: 'New game posts', owner: 'Marketing', status: 'active', schedule: 'every hour', nextRun: '2026-11-18T16:00:00.000Z', waitingForYou: ['2 posts or records to handle'], resultsGoOut: 'facebook: automatic, reddit: waits for a person', spentThisMonthUsd: 0.42 });
    expect(groups[0].jobs[0]).toMatchObject({ owner: 'Operations', status: 'paused', schedule: 'daily at 09:00', nextRun: null, waitingForYou: ['1 result to review'], resultsGoOut: 'a person reviews each result' });
    expect(groups[1].jobs[1]).toMatchObject({ status: 'proposed', schedule: 'every 3 days', waitingForYou: ['approval of its plan', '1 link opportunity'] });
  });

  it('shows a running job as working, with what it is doing', () => {
    const [group] = summarizeJobs([job({ runs: [{ status: 'running', progressState: { label: 'Reading sites' } }] })]);
    expect(group.jobs[0].status).toBe('working now (Reading sites)');
  });
});
