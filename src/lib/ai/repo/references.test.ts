import { describe, expect, it } from 'vitest';
import { findReferences, reachableFrom, routeFileFor, routeForFile } from './references';

const files = new Map<string, string>([
  ['src/games/acmecore.ts', "export const acmecore = { editions: ['AcmeSync'] };\n"],
  ['src/games/index.ts', "export * from './acmecore';\n"],
  ['src/lib/servers.ts', "import { acmecore } from '@/games';\nexport const list = [acmecore];\n"],
  ['src/app/admin/(shell)/connect/user-settings/page.tsx', "import { list } from '../../../../../lib/servers';\nimport React from 'react';\n"],
  ['src/app/unrelated/page.tsx', "import x from 'react';\n"],
]);

describe('findReferences', () => {
  it('follows relative and @/ imports, through index files, up to the page that renders the data', () => {
    const result = findReferences(files, 'src/games/acmecore.ts');
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.references.map((r) => [r.path, r.depth])).toEqual([
      ['src/games/index.ts', 1],
      ['src/lib/servers.ts', 2],
      ['src/app/admin/(shell)/connect/user-settings/page.tsx', 3],
    ]);
    expect(result.routes).toEqual(['/admin/connect/user-settings']);
  });

  it('respects the depth limit and reports a missing file', () => {
    const shallow = findReferences(files, 'src/games/acmecore.ts', { maxDepth: 1 });
    expect('error' in shallow ? [] : shallow.references.map((r) => r.path)).toEqual(['src/games/index.ts']);
    expect(findReferences(files, 'src/nope.ts')).toMatchObject({ error: expect.stringContaining('No file') });
  });
});

describe('findReferences in a project that lives in a subfolder', () => {
  it('resolves the @/ alias against the importer\'s own src folder', () => {
    const monorepo = new Map<string, string>([
      ['platform/src/lib/data/editions.ts', "export const editions = ['AcmeSync'];\n"],
      ['platform/src/components/Manager.tsx', "import { editions } from '@/lib/data/editions';\n"],
      ['platform/src/app/admin/connect/user-settings/page.tsx', "import Manager from '@/components/Manager';\n"],
      ['launcher/src/lib/data/editions.ts', 'export const other = 1;\n'],
    ]);
    const result = findReferences(monorepo, 'platform/src/lib/data/editions.ts');
    expect('error' in result ? [] : result.routes).toEqual(['/admin/connect/user-settings']);
  });
});

describe('Pages Router projects', () => {
  it('maps pages/ files to routes and follows fetches of pages/api routes', () => {
    expect(routeForFile('web/pages/admin/users.tsx')).toBe('/admin/users');
    expect(routeForFile('pages/index.tsx')).toBe('/');
    expect(routeForFile('pages/blog/index.js')).toBe('/blog');
    expect(routeForFile('pages/_app.tsx')).toBeNull();
    const site = new Map<string, string>([
      ['pages/admin/users.tsx', "export default function P() { fetch('/api/users/list'); return null }\n"],
      ['pages/api/users/list.ts', "import { db } from '../../../lib/db';\n"],
      ['lib/db.ts', 'export const db = {};\n'],
    ]);
    expect(reachableFrom(site, 'pages/admin/users.tsx').sort()).toEqual(['lib/db.ts', 'pages/api/users/list.ts']);
    expect(routeFileFor(site, 'the /admin/users page is slow')?.file).toBe('pages/admin/users.tsx');
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

describe('forward tracing from a page', () => {
  const app = new Map<string, string>([
    ['platform/src/app/admin/connect/user-settings/page.tsx', "import Manager from '@/components/Manager';\nexport default function P() { return null; }\n"],
    ['platform/src/components/Manager.tsx', "import { editions } from '@/lib/data/editions';\nexport async function load() { return fetch(`/api/admin/connect/user-settings/community-hosting/${id}`); }\n"],
    ['platform/src/lib/data/editions.ts', "export const editions = ['AcmeSync'];\n"],
    ['platform/src/app/api/admin/connect/user-settings/community-hosting/[id]/route.ts', "import { catalog } from '@/lib/gameHost/catalog';\n"],
    ['platform/src/lib/gameHost/catalog.ts', "export const catalog = { acmesync: {} };\n"],
    ['platform/src/lib/unrelated.ts', "export const x = 1;\n"],
    ['platform/game-host/recipes.js', "module.exports = { acmesync: {} };\n"],
  ]);

  it('follows imports and fetches of the app\'s own API routes, and nothing unrelated', () => {
    const page = 'platform/src/app/admin/connect/user-settings/page.tsx';
    expect(reachableFrom(app, page).sort()).toEqual([
      'platform/src/app/api/admin/connect/user-settings/community-hosting/[id]/route.ts',
      'platform/src/components/Manager.tsx',
      'platform/src/lib/data/editions.ts',
      'platform/src/lib/gameHost/catalog.ts',
    ]);
  });

  it('finds the page a request names by its URL, and prefers the page over an API route', () => {
    expect(routeFileFor(app, 'On example.com/admin/connect/user-settings, AcmeSync is listed twice.')).toEqual({
      file: 'platform/src/app/admin/connect/user-settings/page.tsx', route: '/admin/connect/user-settings',
    });
    expect(routeFileFor(app, 'The layout looks off.')).toBeNull();
    expect(routeFileFor(app, 'see /admin/nowhere/here')).toBeNull();
  });
});
