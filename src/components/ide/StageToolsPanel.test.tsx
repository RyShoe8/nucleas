import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StageToolsPanel from '@/components/ide/StageToolsPanel';

describe('StageToolsPanel', () => {
  it('lists each stage with its model and tools and stays closed when every stage looked at the repo', () => {
    const html = renderToStaticMarkup(
      <StageToolsPanel stageTools={[
        { stage: 'planner', model: 'gemma', toolsUsed: ['repo_search', 'repo_references'] },
        { stage: 'worker', model: 'qwen', toolsUsed: ['repo_read'] },
        { stage: 'reviewer', model: 'gemma', toolsUsed: [] },
      ]} />
    );
    expect(html).toContain('repo_references');
    expect(html).toContain('no tools (by design)');
    expect(html).not.toContain('never looked at the repository');
    expect(html).not.toContain(' open=');
  });

  it('opens and warns when the worker never touched the repository', () => {
    const html = renderToStaticMarkup(
      <StageToolsPanel stageTools={[
        { stage: 'planner', model: 'gemma', toolsUsed: ['repo_search'] },
        { stage: 'worker', model: 'qwen', toolsUsed: [] },
      ]} />
    );
    expect(html).toContain('Worker never looked at the repository');
    expect(html).toContain(' open=');
    expect(html).toContain('>none<');
  });

  it('does not flag a build worker that used its sandbox, and renders nothing without data', () => {
    const html = renderToStaticMarkup(<StageToolsPanel stageTools={[{ stage: 'worker', model: 'qwen', toolsUsed: ['sandbox_edit', 'command_execute'] }]} />);
    expect(html).not.toContain('never looked');
    expect(renderToStaticMarkup(<StageToolsPanel stageTools={[]} />)).toBe('');
  });
});
