import { describe, expect, it } from 'vitest';
import { jobListProgress, type JobView } from './JobCard';

function job(overrides: Partial<JobView>): JobView {
  return {
    id: 'job-1', companyId: 'company-1', projectId: null, companyName: 'Company', status: 'active', request: 'Run work', design: null,
    answers: {}, completion: 'automatic', level: 'free', monthlyBudgetMicros: 0, spentThisMonthMicros: 0, deliveryLabel: null,
    deliveryRunnable: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', lastRunAt: null,
    nextRunAt: null, error: null, runs: [], canManage: true, opportunities: [], ...overrides,
  };
}

describe('jobListProgress', () => {
  it('uses persisted run milestones for active and queued work', () => {
    const progress = jobListProgress(job({ runs: [{
      id: 'run-1', dryRun: false, status: 'running', attempt: 1, startedAt: '2026-10-01T00:00:00.000Z', finishedAt: null,
      heartbeatAt: null, progress: ['Queued'], progressState: { stage: 'preparing', label: 'Queued · waiting for the VPS crawl worker', percent: 5, updatedAt: '2026-10-01T00:00:00.000Z' },
      output: null, issues: [], review: null, costMicros: 0, error: null,
    }] }));
    expect(progress).toEqual({ label: 'Queued · waiting for the VPS crawl worker', percent: 5, tone: 'active' });
  });

  it('shows idle recurring and terminal job states without pretending work is running', () => {
    expect(jobListProgress(job({ status: 'active' }))).toMatchObject({ label: 'Waiting for next run', percent: 0 });
    expect(jobListProgress(job({ status: 'done' }))).toEqual({ label: 'Complete', percent: 100, tone: 'complete' });
    expect(jobListProgress(job({ status: 'failed', error: 'Worker stopped' }))).toEqual({ label: 'Worker stopped', percent: 100, tone: 'failed' });
  });
});
