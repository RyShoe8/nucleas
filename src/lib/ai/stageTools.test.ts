import { describe, expect, it } from 'vitest';
import { summarizeStageTools } from './stageTools';

describe('summarizeStageTools', () => {
  it('flags a worker that never touched the repository and merges repeated passes', () => {
    const summary = summarizeStageTools([
      { stage: 'reviewer', model: 'gemma', toolsUsed: [] },
      { stage: 'worker', model: 'qwen', toolsUsed: [] },
      { stage: 'planner', model: 'gemma', toolsUsed: ['repo_search', 'repo_read'] },
      { stage: 'worker', model: 'qwen', toolsUsed: ['web_search'] },
    ]);
    expect(summary.markdown.split('\n')).toEqual([
      '**Tools used**',
      '- Planner (gemma): repo_search, repo_read',
      '- Worker (qwen): web_search ⚠ no repository tools',
      '- Reviewer (gemma): no tools (by design)',
    ]);
    expect(summary.warnings).toEqual([expect.stringContaining('Worker (qwen) never called a repository tool')]);
  });

  it('does not flag a build worker that used its sandbox', () => {
    const summary = summarizeStageTools([{ stage: 'worker', model: 'qwen', toolsUsed: ['sandbox_edit', 'command_execute'] }], { buildMode: true });
    expect(summary.warnings).toEqual([]);
  });

  it('is empty when there is nothing to report', () => {
    expect(summarizeStageTools([]).markdown).toBe('');
  });
});
