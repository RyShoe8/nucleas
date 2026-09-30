import { describe, expect, it } from 'vitest';
import { checkNoChangeClaim, claimsNothingFound, keyTerms } from './noChangeGuard';

const request = "On playbound.club/admin/connect/game-servers, OpenHV is listed on its own and also under OpenRA. Remove the listing under OpenRA.";
const report = "1. **Search for 'OpenHV'**: No explicit nested 'OpenHV' entry under 'OpenRA' found in the provided files.\n2. Inspect `platform/src/lib/data/games.ts`: defines OpenRA and OpenHV, no nested structure identified.\nNo such nested entry was found, so no removal was necessary.";

const files = new Map<string, string>([
  ['platform/src/lib/data/games.ts', "export const games = [{ id: 'openra' }, { id: 'openhv' }]; // OpenRA OpenHV"],
  ['platform/src/lib/gameHost/mods.ts', "export const openra = { name: 'OpenRA', mods: ['ra', 'OpenHV'] };"],
  ['platform/src/lib/gameHost/mods.test.ts', "OpenRA OpenHV"],
  ['README.md', 'OpenRA OpenHV'],
  ['platform/src/app/other.ts', 'OpenRA only'],
]);

describe('key terms and claims', () => {
  it('extracts the distinctive names, not sentence words', () => {
    expect(keyTerms(request)).toEqual(expect.arrayContaining(['OpenHV', 'OpenRA', 'game-servers']));
    expect(keyTerms(request)).not.toContain('Remove');
  });

  it('recognises "found nothing" and "no change needed" wording', () => {
    expect(claimsNothingFound(report)).toBe(true);
    expect(claimsNothingFound('No changes are necessary here.')).toBe(true);
    expect(claimsNothingFound('The entry lives in games.ts and should be deleted.')).toBe(false);
  });
});

describe('checkNoChangeClaim', () => {
  it('sends the worker to files that mention the request terms but were never covered', () => {
    const result = checkNoChangeClaim({ userText: request, workerText: report, files });
    expect(result?.unexplored.map((f) => f.path)).toEqual(['platform/src/lib/gameHost/mods.ts']);
    expect(result?.jobs[0]).toContain('Read platform/src/lib/gameHost/mods.ts');
  });

  it('stays quiet when the report makes no such claim or every matching file is covered', () => {
    expect(checkNoChangeClaim({ userText: request, workerText: 'Remove OpenHV from mods.ts.', files })).toBeNull();
    expect(checkNoChangeClaim({ userText: request, workerText: `${report}\nAlso read platform/src/lib/gameHost/mods.ts.`, files })).toBeNull();
  });
});
