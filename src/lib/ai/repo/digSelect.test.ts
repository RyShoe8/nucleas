import { describe, expect, it } from 'vitest';
import { identifierTerms, snapshotCandidates } from './digSelect';

const request = 'On example.com/admin/connect/user-settings, AcmeSync is listed on its own and also under AcmeCore. Remove the listing under AcmeCore.';

describe('identifierTerms', () => {
  it('keeps distinctive names and drops ordinary and URL words', () => {
    expect(identifierTerms(request)).toEqual(['acmesync', 'acmecore']);
    expect(identifierTerms('fix SettingsManager and E2140 in the admin page')).toEqual(['settingsmanager', 'e2140']);
  });
});

describe('snapshotCandidates', () => {
  const files = new Map<string, string>([
    // Path words match a lot of files that never mention the names.
    ['app/admin/connect/user-settings/page.tsx', 'export default function Page() { return null }'],
    ['app/admin/connect/parties/page.tsx', 'connect admin parties'],
    ['app/api/admin/connect/user-settings/route.ts', 'user-settings admin connect'],
    ['lib/data/editions.ts', "export const acmecore = { editions: ['Base game', 'AcmeSync'] }"],
    ['lib/data/other.ts', 'export const acmesync = {}'],
    ['lib/data/editions.test.ts', "expect(acmecore).toContain('AcmeSync')"],
    ['docs/notes.md', 'AcmeSync and AcmeCore notes'],
  ]);

  it('ranks the file that holds both names above files that only share path words, and tests/docs below source', () => {
    const top = snapshotCandidates({ files }, request, 7);
    expect(top[0]).toBe('lib/data/editions.ts');
    expect(top.indexOf('lib/data/editions.ts')).toBeLessThan(top.indexOf('lib/data/editions.test.ts'));
    expect(top.indexOf('lib/data/editions.ts')).toBeLessThan(top.indexOf('docs/notes.md'));
  });

  it('boosts files inside the scope of the page the request names', () => {
    const noisy = new Map(files);
    noisy.set('server/recipes.js', "acmecore acmesync launcher recipe");
    const without = snapshotCandidates({ files: noisy }, request, 3);
    const scoped = snapshotCandidates({ files: noisy }, request, 3, { scope: new Set(['lib/data/editions.ts']) });
    expect(scoped[0]).toBe('lib/data/editions.ts');
    expect(without).toContain('server/recipes.js');
  });
});
