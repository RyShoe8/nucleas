import { describe, expect, it } from 'vitest';
import { buildStage, jobStage } from './teamStages';
import { groupTimeline } from './CompanyTimeline';
import type { FeedItem } from '@/lib/companies/activityFeed';

const job = (status: string, runs: { status: string }[] = [], ready = 0) => ({ status, runs, publishing: { ready: Array(ready).fill({}) } });

describe('where work stands and what a person does next', () => {
  it('asks for one action at each point that waits on a person', () => {
    expect(jobStage(job('needs_answers'))).toMatchObject({ step: 0, group: 'you', action: 'Answer questions' });
    expect(jobStage(job('proposed'))).toMatchObject({ step: 1, group: 'you', action: 'Review plan' });
    expect(jobStage(job('proposed', [{ status: 'failed' }]))).toMatchObject({ group: 'you', action: 'See what failed' });
    expect(jobStage(job('testing', [{ status: 'needs_review' }]))).toMatchObject({ step: 2, group: 'you', action: 'Check test result' });
    expect(jobStage(job('active', [{ status: 'completed' }, { status: 'needs_review' }]))).toMatchObject({ step: 3, group: 'you', action: 'Review result' });
    expect(jobStage(job('active', [], 2))).toMatchObject({ group: 'you', action: 'Review 2 posts' });
    expect(jobStage(job('active', [{ status: 'failed' }]))).toMatchObject({ group: 'you', action: 'See what failed' });
  });

  it('asks for nothing while the team is working or the work runs on schedule', () => {
    for (const stage of [jobStage(job('designing')), jobStage(job('testing', [{ status: 'running' }])), jobStage(job('active', [{ status: 'running' }]))]) {
      expect(stage.group).toBe('moving');
      expect(stage.action).toBeUndefined();
    }
    expect(jobStage(job('active', [{ status: 'completed' }]))).toMatchObject({ step: 3, group: 'live', label: 'On schedule' });
    expect(jobStage(job('paused')).group).toBe('rest');
  });

  it('puts code changes on the same steps', () => {
    expect(buildStage('proposed')).toMatchObject({ step: 1, group: 'you', action: 'Review plan' });
    expect(buildStage('building')).toMatchObject({ step: 2, group: 'moving' });
    expect(buildStage('ready')).toMatchObject({ group: 'you', action: 'Review change' });
    expect(buildStage('pr_opened').group).toBe('rest');
  });
});

describe('the activity timeline', () => {
  const item = (id: string, at: string, repeatKey?: string): FeedItem => ({ id, at, kind: 'work', tone: 'ok', title: id, repeatKey });

  it('lists newest first whatever order the items arrive in', () => {
    const days = groupTimeline([item('old', '2026-11-08T15:00:00'), item('new', '2026-11-10T09:00:00'), item('mid', '2026-11-10T08:00:00')]);
    expect(days.map(d => d.rows.map(r => r.id))).toEqual([['new', 'mid'], ['old']]);
  });

  it('folds back-to-back repeats into one row but keeps anything that happened between them', () => {
    const days = groupTimeline([
      item('a3', '2026-11-10T12:00:00', 'k'), item('a2', '2026-11-10T11:00:00', 'k'), item('other', '2026-11-10T10:30:00'),
      item('a1', '2026-11-10T10:00:00', 'k'), item('yesterday', '2026-11-09T12:00:00', 'k'),
    ]);
    expect(days[0].rows.map(r => [r.id, r.count])).toEqual([['a3', 2], ['other', 1], ['a1', 1]]);
    expect(days[0].rows[0].firstAt).toBe('2026-11-10T11:00:00');
    expect(days[1].rows.map(r => [r.id, r.count])).toEqual([['yesterday', 1]]);
  });
});
