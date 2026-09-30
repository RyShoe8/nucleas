import { describe, expect, it } from 'vitest';
import { describeEntry, enclosingEntry } from './entryFacts';

const editions = [
  'export const editions = [',
  '  {',
  '    gameSlug: "tiberian",',
  '    slug: "hd",',
  '    aliases: ["TD HD", "OpenRA TD HD"],',
  '  },',
  '  {',
  '    gameSlug: "openra",',
  '    slug: "openhv",',
  '    name: "OpenHV",',
  '    links: { site: "https://x" },',
  '  },',
  '];',
].join('\n');

describe('enclosingEntry', () => {
  it('says which object a line belongs to and what holds it, so no structure needs inventing', () => {
    const entry = enclosingEntry(editions, 9)!;
    expect([entry.start, entry.end]).toEqual([7, 12]);
    expect(entry.fields.map((f) => `${f.key}=${f.value}`)).toEqual(['gameSlug="openra"', 'slug="openhv"', 'name="OpenHV"', 'links=…']);
    expect(entry.container).toEqual({ line: 1, text: 'export const editions = [' });
    const text = describeEntry('data/editions.ts', 9, editions)!;
    expect(text).toContain('gameSlug: "openra", slug: "openhv"');
    expect(text).toContain('directly inside `export const editions = [`');
  });

  it('handles an object written on one line, and a line outside any object', () => {
    const inline = "export const v = [\n  { parent: 'widget', slug: 'gadgetPro' },\n];";
    const entry = enclosingEntry(inline, 2)!;
    expect(entry.fields.map((f) => f.key)).toEqual(['parent', 'slug']);
    expect(enclosingEntry('const a = 1;\nconst b = 2;', 2)).toBeNull();
  });
});
