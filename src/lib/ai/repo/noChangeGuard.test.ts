import { describe, expect, it } from 'vitest';
import { checkNoChangeClaim, claimsNothingFound, keyTerms } from './noChangeGuard';

const request = "On example.com/admin/connect/user-settings, AcmeSync is listed on its own and also under AcmeCore. Remove the listing under AcmeCore.";
const report = "1. **Search for 'AcmeSync'**: No explicit nested 'AcmeSync' entry under 'AcmeCore' found in the provided files.\n2. Inspect `platform/src/lib/data/games.ts`: defines AcmeCore and AcmeSync, no nested structure identified.\nNo such nested entry was found, so no removal was necessary.";

const files = new Map<string, string>([
  ['platform/src/lib/data/games.ts', "export const games = [{ id: 'acmecore' }, { id: 'acmesync' }]; // AcmeCore AcmeSync"],
  ['platform/src/lib/gameHost/mods.ts', "export const acmecore = { name: 'AcmeCore', mods: ['ra', 'AcmeSync'] };"],
  ['platform/src/lib/gameHost/mods.test.ts', "AcmeCore AcmeSync"],
  ['README.md', 'AcmeCore AcmeSync'],
  ['platform/src/app/other.ts', 'AcmeCore only'],
]);

describe('key terms and claims', () => {
  it('extracts the distinctive names, not sentence words', () => {
    expect(keyTerms(request)).toEqual(expect.arrayContaining(['AcmeSync', 'AcmeCore', 'user-settings']));
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
    expect(checkNoChangeClaim({ userText: request, workerText: 'Remove AcmeSync from mods.ts.', files })).toBeNull();
    expect(checkNoChangeClaim({ userText: request, workerText: `${report}\nAlso read platform/src/lib/gameHost/mods.ts.`, files })).toBeNull();
  });
});

describe('wording seen from real small-model reports', () => {
  it('catches "did not reveal" and "no indication" style conclusions', () => {
    expect(claimsNothingFound('Searching for AcmeSync in the repository did not reveal any specific definition.')).toBe(true);
    expect(claimsNothingFound('Based on the available evidence, there is no indication that AcmeSync is listed under AcmeCore.')).toBe(true);
    expect(claimsNothingFound('AcmeSync is not present under the AcmeCore editions array.')).toBe(true);
    expect(claimsNothingFound('The array lists AcmeSync twice; remove the second entry.')).toBe(false);
  });
});
