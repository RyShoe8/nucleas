import { describe, expect, it } from 'vitest';
import { repoLookups } from './jobLookups';

const files = new Map<string, string>(Object.entries({
  'platform/src/lib/data/games.ts': 'export const games = [\n  { slug: "openra", title: "OpenRA" },\n  {\n    slug: "openhv",\n    title: "OpenHV",\n  },\n];',
  'platform/src/lib/data/editions.ts': 'export const editions = [\n  {\n    gameSlug: "openra",\n    slug: "openhv",\n  },\n];',
  'platform/src/lib/other/games.ts': 'export const x = 1;',
}));

describe('repoLookups', () => {
  it('answers "does games.ts contain slug: openhv" from the code, resolving a bare file name and quote styles', () => {
    const text = repoLookups(files, ['Check if `platform/src/lib/data/games.ts` contains an entry with `slug: "openhv"`.']);
    expect(text).toContain('games.ts:4');
    expect(text).toContain('slug: "openhv"');
    expect(text).toContain('facts from the code');
  });

  it('says plainly when something is not there, and refuses an ambiguous bare file name', () => {
    expect(repoLookups(files, ['Check editions.ts for `slug: "openhq"`'])).toContain('does not occur in platform/src/lib/data/editions.ts');
    // "games.ts" matches two files, so it is searched everywhere rather than guessed.
    expect(repoLookups(files, ['Does games.ts have `slug: "openhv"`?'])).toContain('platform/src/lib/data/games.ts:4');
  });

  it('matches names regardless of case, so a lowercase request term finds the displayed spelling', () => {
    expect(repoLookups(files, ['Check games.ts'], ['openhv'])).not.toContain('does not occur');
  });

  it('adds the request terms and returns nothing when there is nothing to look for', () => {
    expect(repoLookups(files, ['Verify the change.'])).toBe('');
    expect(repoLookups(files, ['Verify the change in editions.ts'], ['openhv'])).toContain('editions.ts:4');
  });
});
