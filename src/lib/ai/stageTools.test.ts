import { describe, expect, it } from 'vitest';
import { stripStageToolsFooter, summarizeStageTools } from './stageTools';

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

  it('says when a stage was retried without tools after an upstream error', () => {
    const summary = summarizeStageTools([{ stage: 'worker', model: 'qwen', toolsUsed: [], compact: true }]);
    expect(summary.markdown).toContain('none ⚠ no repository tools (compact mode)');
    expect(summary.warnings[0]).toContain('retried in compact mode with tools switched off after an upstream error');
  });

  it('says when a stage was retried without tools after an upstream error', () => {
    const summary = summarizeStageTools([{ stage: 'worker', model: 'qwen', toolsUsed: [], compact: true }]);
    expect(summary.markdown).toContain('none ⚠ no repository tools (compact mode)');
    expect(summary.warnings[0]).toContain('retried in compact mode with tools switched off after an upstream error');
  });

  it('is empty when there is nothing to report', () => {
    expect(summarizeStageTools([]).markdown).toBe('');
  });
});

describe('stripStageToolsFooter', () => {
  const summary = summarizeStageTools([
    { stage: 'planner', model: 'gemma', toolsUsed: ['repo_search'] },
    { stage: 'worker', model: 'qwen', toolsUsed: [] },
  ]);
  const footer = [...summary.warnings.map((w) => `⚠ ${w}`), summary.markdown].join('\n\n');

  it('removes the tools report and warnings but keeps the answer', () => {
    expect(stripStageToolsFooter(`The answer.\n\n---\n${footer}`)).toBe('The answer.');
  });

  it('keeps other Nucleas notes that share the footer', () => {
    const note = '**Nucleas check:** Definition of done: FAILED';
    expect(stripStageToolsFooter(`Built it.\n\n---\n${note}\n\n${footer}`)).toBe(`Built it.\n\n---\n${note}`);
  });

  it('leaves text without a footer alone', () => {
    expect(stripStageToolsFooter('Plain answer.\n\n---\nA section divider the model wrote.')).toBe('Plain answer.\n\n---\nA section divider the model wrote.');
  });
});
