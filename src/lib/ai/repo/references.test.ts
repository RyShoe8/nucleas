import { describe, expect, it } from 'vitest';
import { findReferences, routeForFile } from './references';

const files = new Map<string, string>([
  ['src/games/openra.ts', "export const openra = { editions: ['OpenHV'] };\n"],
  ['src/games/index.ts', "export * from './openra';\n"],
  ['src/lib/servers.ts', "import { openra } from '@/games';\nexport const list = [openra];\n"],
  ['src/app/admin/(shell)/connect/game-servers/page.tsx', "import { list } from '../../../../../lib/servers';\nimport React from 'react';\n"],
  ['src/app/unrelated/page.tsx', "import x from 'react';\n"],
]);

describe('findReferences', () => {
  it('follows relative and @/ imports, through index files, up to the page that renders the data', () => {
    const result = findReferences(files, 'src/games/openra.ts');
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.references.map((r) => [r.path, r.depth])).toEqual([
      ['src/games/index.ts', 1],
      ['src/lib/servers.ts', 2],
      ['src/app/admin/(shell)/connect/game-servers/page.tsx', 3],
    ]);
    expect(result.routes).toEqual(['/admin/connect/game-servers']);
  });

  it('respects the depth limit and reports a missing file', () => {
    const shallow = findReferences(files, 'src/games/openra.ts', { maxDepth: 1 });
    expect('error' in shallow ? [] : shallow.references.map((r) => r.path)).toEqual(['src/games/index.ts']);
    expect(findReferences(files, 'src/nope.ts')).toMatchObject({ error: expect.stringContaining('No file') });
  });
});

describe('routeForFile', () => {
  it('strips route groups and handles the root page', () => {
    expect(routeForFile('src/app/page.tsx')).toBe('/');
    expect(routeForFile('src/app/(auth)/login/page.tsx')).toBe('/login');
    expect(routeForFile('src/app/api/x/route.ts')).toBe('/api/x');
    expect(routeForFile('src/lib/a.ts')).toBeNull();
  });
});
