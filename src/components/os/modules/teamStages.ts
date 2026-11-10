/**
 * Where a piece of work is on its way from request to running, and the one thing (if any) a person
 * must do next. Every responsibility and code change follows the same four steps.
 */
export const STEPS = ['Plan', 'Approve', 'Test', 'Running'] as const;
export type StageGroup = 'you' | 'moving' | 'live' | 'rest';
export interface Stage {
  step: 0 | 1 | 2 | 3;
  group: StageGroup;
  /** What is happening, in a few words. */
  label: string;
  /** The single next action for a person; absent when nothing is needed. */
  action?: string;
}

type JobLike = {
  status: string;
  runs: { status: string; dryRun?: boolean }[];
  publishing?: { ready: unknown[] } | null;
};

export function jobStage(job: JobLike): Stage {
  const latest = job.runs[0];
  const running = job.runs.some(r => r.status === 'running');
  const review = job.runs.find(r => r.status === 'needs_review');
  const posts = job.publishing?.ready.length ?? 0;
  switch (job.status) {
    case 'designing': return { step: 0, group: 'moving', label: 'Writing the plan' };
    case 'needs_answers': return { step: 0, group: 'you', label: 'Needs a few answers before planning', action: 'Answer questions' };
    case 'proposed': return latest?.status === 'failed'
      ? { step: 1, group: 'you', label: 'Test run failed', action: 'See what failed' }
      : { step: 1, group: 'you', label: 'Plan ready', action: 'Review plan' };
    case 'testing': return review
      ? { step: 2, group: 'you', label: 'Test run finished', action: 'Check test result' }
      : { step: 2, group: 'moving', label: 'Doing a test run' };
    case 'failed': return { step: 1, group: 'you', label: 'Could not be planned', action: 'See what failed' };
    case 'ready':
    case 'active':
      if (review) return { step: 3, group: 'you', label: 'Result waiting for review', action: 'Review result' };
      if (posts) return { step: 3, group: 'you', label: `${posts} post${posts === 1 ? '' : 's'} ready`, action: posts === 1 ? 'Review post' : `Review ${posts} posts` };
      if (latest?.status === 'failed') return { step: 3, group: 'you', label: 'Latest run failed', action: 'See what failed' };
      if (running) return { step: 3, group: 'moving', label: 'Running now' };
      return { step: 3, group: 'live', label: job.status === 'active' ? 'On schedule' : 'Ready to run' };
    case 'paused': return { step: 3, group: 'rest', label: 'Paused' };
    case 'done': return { step: 3, group: 'rest', label: 'Finished' };
    default: return { step: 1, group: 'rest', label: job.status === 'rejected' ? 'Plan rejected' : 'Closed' };
  }
}

export function buildStage(status: string): Stage {
  switch (status) {
    case 'proposed': return { step: 1, group: 'you', label: 'Plan ready', action: 'Review plan' };
    case 'queued': return { step: 2, group: 'moving', label: 'Queued to build' };
    case 'building': return { step: 2, group: 'moving', label: 'Building and checking' };
    case 'ready': return { step: 2, group: 'you', label: 'Change ready', action: 'Review change' };
    case 'failed': return { step: 2, group: 'you', label: 'Build failed', action: 'See what failed' };
    case 'pr_opened': return { step: 3, group: 'rest', label: 'Pull request open' };
    default: return { step: 1, group: 'rest', label: status === 'rejected' ? 'Plan rejected' : 'Discarded' };
  }
}
