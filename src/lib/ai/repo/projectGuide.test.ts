import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/teamChat', () => ({ attemptOrchestratedIdeReply: vi.fn(), BUILD_METHOD: 'How to work: use git grep.' }));

import { projectGuide } from './projectGuide';
import type { LoadedSnapshot } from './snapshot';

function snapshot(files: Record<string, string>): LoadedSnapshot {
  return { owner: 'RyShoe8', repo: 'playbound', commit: 'abc123def4567890', branch: 'main', files: new Map(Object.entries(files)), skipped: ['public/logo.png'] };
}

describe('project guide', () => {
  it('puts AI instructions first, summarises scripts and stack, and lists the top level', () => {
    const guide = projectGuide(
      snapshot({
        'README.md': '# PlayBound\nGame hosting.',
        'CLAUDE.md': 'Use server actions. Never edit generated files.',
        '.cursor/rules/style.mdc': 'Prefer named exports.',
        'package.json': JSON.stringify({ name: 'playbound', scripts: { dev: 'next dev', lint: 'eslint', test: 'vitest run', postinstall: 'x' }, dependencies: { next: '16.0.0', react: '19.0.0' }, devDependencies: { typescript: '5.9.0' } }),
        'src/app/page.tsx': 'x',
      })
    );
    expect(guide.indexOf('--- CLAUDE.md ---')).toBeLessThan(guide.indexOf('--- .cursor/rules/style.mdc ---'));
    expect(guide.indexOf('--- .cursor/rules/style.mdc ---')).toBeLessThan(guide.indexOf('--- README.md ---'));
    expect(guide).toContain('stack: next@16.0.0, react@19.0.0, typescript@5.9.0');
    expect(guide).toContain('npm run lint: eslint');
    expect(guide).not.toContain('postinstall');
    expect(guide).toContain('Top level: .cursor/  public/  src/  CLAUDE.md');
  });

  it('stays within its size budget', () => {
    const guide = projectGuide(snapshot({ 'CLAUDE.md': 'a'.repeat(50_000), 'README.md': 'b'.repeat(50_000) }), 6000);
    expect(guide.length).toBeLessThan(6500);
  });
});

describe('build task', () => {
  it('always fits the build service limit, keeping the plan ahead of the guide', async () => {
    const { buildTask } = await import('@/lib/building/builds');
    const long = buildTask({ title: 'Big', planMarkdown: 'p'.repeat(20_000) }, 'g'.repeat(5000));
    expect(long.length).toBeLessThanOrEqual(12_000);
    expect(long).toContain('[...plan continues...]');
    expect(long).not.toContain('Project guide');
    const short = buildTask({ title: 'Small', planMarkdown: '1. Edit the list.' }, 'GUIDE');
    expect(short).toContain('How to work: use git grep.');
    expect(short).toContain('Project guide (excerpt):\nGUIDE');
  });
});
