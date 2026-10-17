import { describe, expect, it } from 'vitest';
import { jobListProgress, type JobView } from './JobCard';

function job(overrides: Partial<JobView>): JobView {
  return {
    id: 'job-1', companyId: 'company-1', projectId: null, companyName: 'Company', status: 'active', request: 'Run work', design: null,
    answers: {}, completion: 'automatic', level: 'free', monthlyBudgetMicros: 0, spentThisMonthMicros: 0, deliveryLabel: null,
    deliveryRunnable: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', lastRunAt: null,
    nextRunAt: null, error: null, runs: [], canManage: true, opportunities: [], publishing: null, ...overrides,
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

  it('shows a failed approved dry run instead of saying it still needs approval', () => {
    expect(jobListProgress(job({ status: 'proposed', runs: [{
      id: 'run-1', dryRun: true, status: 'failed', attempt: 1, startedAt: '2026-10-01T00:00:00.000Z', finishedAt: '2026-10-01T00:01:00.000Z',
      heartbeatAt: '2026-10-01T00:01:00.000Z', progress: [], progressState: { stage: 'complete', label: 'Run stopped', percent: 100, updatedAt: '2026-10-01T00:01:00.000Z' },
      output: null, issues: [], review: null, costMicros: 0, error: 'The upstream model gateway timed out.',
    }] }))).toEqual({ label: 'The upstream model gateway timed out.', percent: 100, tone: 'failed' });
  });

  it('puts posts waiting for a person first, and says hourly jobs check every hour', () => {
    const delivery = { id: 'd', platform: 'reddit' as const, status: 'ready' as const, itemTitle: 'Factorio', title: 'New', body: 'Body', link: null, assets: [], postedUrl: null, postedAt: null, error: null, createdAt: '2026-10-01T00:00:00.000Z', fields: null, screenshot: null };
    const publishing = { channels: [], notifyUserIds: [], examples: {}, source: { type: 'site' as const, feedUrl: 'https://a.com/sitemap.xml', feedKind: 'sitemap' as const, pathPrefix: '/games/', noun: 'game' }, notes: {}, admin: null, ready: [delivery, { ...delivery, id: 'e' }], recent: [], postedThisWeek: 0 };
    expect(jobListProgress(job({ publishing }))).toEqual({ label: '2 waiting for you', percent: 100, tone: 'waiting' });
    const hourly = { title: 'Post new games', category: 'marketing', instructions: '', fields: [], sourcePolicy: '', delivery: { method: 'integration', detail: '', setupSteps: [] }, schedule: { kind: 'hourly' as const }, recordsPerRun: 1, safeguards: [], recommendedCompletion: 'automatic' as const, findings: [], questions: [] };
    expect(jobListProgress(job({ design: hourly, publishing: { ...publishing, ready: [] } }))).toEqual({ label: 'Checks every hour', percent: 0, tone: 'complete' });
  });
});
