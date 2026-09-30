import { describe, expect, it } from 'vitest';
import { keywordBaseline, isSourceFile, maskPaths, mineCases, scorePlanTargets, scoreRetrieval, summarize } from './replay';

describe('mineCases', () => {
  const exists = new Set(['src/a.ts', 'src/b.ts', 'src/legacy.ts']);
  const commits = [
    { sha: 'aaaaaaaaaa', subject: 'Hide the duplicate row on the admin list', body: 'It was listed twice.\n\nMore detail.', files: ['src/a.ts', 'src/a.test.ts', 'README.md'] },
    { sha: 'bbbbbbbbbb', subject: 'Merge branch main into feature', body: '', files: ['src/a.ts'] },
    { sha: 'cccccccccc', subject: 'Fix typo', body: '', files: ['src/a.ts'] },
    { sha: 'dddddddddd', subject: 'Rewrite everything across the whole codebase', body: '', files: Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`) },
    { sha: 'eeeeeeeeee', subject: 'Update lockfile after dependency changes', body: '', files: ['package-lock.json'] },
    { sha: 'ffffffffff', subject: 'Remove a legacy code path that no longer exists', body: '', files: ['src/gone.ts'] },
    { sha: 'gggggggggg', subject: 'Show the total on the invoice page', body: '', files: ['src/b.ts', 'src/legacy.ts'] },
  ];

  it('keeps focused requests, and only answer files that are source and still exist', () => {
    expect(mineCases(commits, exists)).toEqual([
      { id: 'aaaaaaaa', request: 'Hide the duplicate row on the admin list. It was listed twice.', truth: ['src/a.ts'] },
      { id: 'gggggggg', request: 'Show the total on the invoice page', truth: ['src/b.ts', 'src/legacy.ts'] },
    ]);
  });

  it('classifies source files', () => {
    expect(isSourceFile('src/a.ts')).toBe(true);
    for (const f of ['src/a.test.ts', 'docs/plan.md', 'yarn.lock', 'a/__tests__/x.ts', 'public/logo.png']) expect(isSourceFile(f)).toBe(false);
  });

  it('can mask file names so a request cannot be answered by matching them', () => {
    expect(maskPaths('Fix src/lib/rows.ts and page.tsx handling')).toBe('Fix the file and the file handling');
  });
});

describe('scoring', () => {
  it('scores retrieval by recall in the first k files and the rank of the first hit', () => {
    expect(scoreRetrieval(['x', 'a', 'y', 'b'], ['a', 'b'], 3)).toEqual({ recall: 0.5, hit: true, firstRank: 2 });
    expect(scoreRetrieval(['x', 'y'], ['a'], 8)).toEqual({ recall: 0, hit: false, firstRank: 0 });
  });

  it('scores a plan\'s files by precision and recall against the real change, ignoring tests and docs', () => {
    const s = scorePlanTargets(['src/a.ts', 'src/wrong.ts', 'src/a.test.ts', 'docs/x.md'], ['src/a.ts', 'src/b.ts']);
    expect(s.precision).toBe(0.5);
    expect(s.recall).toBe(0.5);
    expect(s.f1).toBe(0.5);
    expect(scorePlanTargets([], ['src/a.ts'])).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  it('summarises many cases', () => {
    expect(summarize([{ recall: 1, hit: true, firstRank: 1 }, { recall: 0.5, hit: true, firstRank: 3 }, { recall: 0, hit: false, firstRank: 0 }])).toEqual({ cases: 3, hitRate: 2 / 3, meanRecall: 0.5, meanFirstRank: 2 });
  });
});

describe('keywordBaseline', () => {
  it('ranks by path and content words, like the dig did before tracing', () => {
    const files = new Map([['app/admin/users/page.tsx', 'x'], ['lib/rows.ts', 'invoice total'], ['lib/other.ts', 'nothing']]);
    expect(keywordBaseline(files, 'invoice total on the users admin page', 3)).toEqual(['app/admin/users/page.tsx', 'lib/rows.ts']);
  });
});
