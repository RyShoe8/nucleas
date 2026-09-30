import { describe, expect, it } from 'vitest';
import { automaticPlanSections, checkPlanClaims, groupReaders, readerCoverageIssues, readersOfPlannedFiles, unaddressedReaders } from './claimCheck';
import { buildEvidencePack } from './evidencePack';

const files = new Map<string, string>(Object.entries({
  'package.json': '{"dependencies":{"next":"14"}}',
  'app/admin/catalog/page.tsx': "import Panel from '@/components/Panel';\nexport default function Page() { return <Panel /> }",
  'components/Panel.tsx': "export default function Panel() { fetch('/api/admin/catalog/items'); return null }",
  'app/api/admin/catalog/items/route.ts': [
    "import { seedVariants } from '@/lib/data/variants';",
    'export async function GET() {',
    '  const rows = [];',
    '  for (const v of seedVariants) {',
    '    rows.push({ key: `${v.parent}:${v.slug}` });',
    '  }',
    '  return Response.json(rows);',
    '}',
  ].join('\n'),
  'lib/data/variants.ts': "export const seedVariants = [\n  { parent: 'widget', slug: 'gadgetPro' },\n];",
  'app/shop/[slug]/page.tsx': "import { seedVariants } from '@/lib/data/variants';",
  'lib/settings.ts': 'export const OPTIONS = { ...DEFAULTS, slug: "gadgetPro" };',
}));

const pack = buildEvidencePack(files, 'On example.com/admin/catalog, gadgetPro is listed twice.')!;
const opts = { scope: pack.scope, pageFile: pack.page!.file };

describe('checkPlanClaims', () => {
  it('verifies quotes that exist, ignoring whitespace and quote style, and tolerating "..." elision', () => {
    const plan = { steps: [], structured: { rootCause: { explanation: 'x', evidence: [
      { file: 'lib/data/variants.ts', line: 2, quote: '{ parent: "widget",   slug: "gadgetPro" },' },
      { file: 'app/api/admin/catalog/items/route.ts', line: 5, quote: 'rows.push({ key: ... })' },
    ] } } };
    const check = checkPlanClaims(files, plan, opts);
    expect(check.unverified).toEqual([]);
    expect(check.verified).toHaveLength(2);
    expect(check.issues).toEqual([]);
  });

  it('catches an invented or misread line and a file that does not exist, with instructions to fix them', () => {
    const plan = { steps: [], structured: { rootCause: { explanation: 'x', evidence: [
      { file: 'lib/data/variants.ts', line: 2, quote: "export const gadgetPro = { parent: 'top-level' };" },
      { file: 'lib/not-there.ts', quote: 'anything at all' },
    ] } } };
    const check = checkPlanClaims(files, plan, opts);
    expect(check.unverified.map((u) => u.reason)).toEqual(['quote_not_found', 'file_missing']);
    expect(check.issues[0]).toContain('was not found in lib/data/variants.ts');
    expect(check.issues[1]).toContain('lib/not-there.ts does not exist');
  });

  it('reports where a quote really is when the cited line is off', () => {
    const plan = { steps: [], structured: { rootCause: { explanation: 'x', evidence: [{ file: 'lib/data/variants.ts', line: 40, quote: "{ parent: 'widget', slug: 'gadgetPro' }," }] } } };
    expect(checkPlanClaims(files, plan, opts).verified[0]).toMatchObject({ actualLine: 2 });
  });

  it('flags edits to code the named page does not use, and evidence that is all off the page path', () => {
    const plan = { steps: ['Edit lib/settings.ts to drop the slug'], structured: { filesToChange: ['lib/settings.ts'], rootCause: { explanation: 'x', evidence: [{ file: 'lib/settings.ts', quote: 'slug: "gadgetPro"' }] } } };
    const check = checkPlanClaims(files, plan, opts);
    expect(check.offPath).toEqual(['lib/settings.ts']);
    expect(check.evidenceOffPath).toBe(true);
    expect(check.issues.join('\n')).toContain('is not used by the page the request names');
    expect(check.issues.join('\n')).toContain('none of the quoted code is in a file the named page uses');
  });

  it('accepts edits on the data path, treats tests and new files as normal, and skips path checks with no named page', () => {
    const onPath = { steps: [], structured: { filesToChange: ['app/api/admin/catalog/items/route.ts', 'app/api/admin/catalog/items/route.test.ts', 'app/api/admin/catalog/items/helpers.ts'] } };
    const check = checkPlanClaims(files, onPath, opts);
    expect(check.offPath).toEqual([]);
    expect(check.newOrUnknown).toEqual(['app/api/admin/catalog/items/route.test.ts', 'app/api/admin/catalog/items/helpers.ts']);
    expect(checkPlanClaims(files, { steps: [], structured: { filesToChange: ['lib/settings.ts'] } }).offPath).toEqual([]);
  });
});

describe('quotes that repeat in a file', () => {
  // Several entries share a field value; only one is the entry the plan means.
  const entries = new Map<string, string>([[
    'data/entries.ts',
    [
      'export const entries = [',
      '  {',
      '    group: "core",', 
      '    slug: "official",',
      '  },',
      '  {',
      '    group: "core",', 
      '    slug: "variant-one",',
      '  },',
      '  {',
      '    group: "core",', 
      '    slug: "variant-two",',
      '  },',
      '  {',
      '    group: "core",', 
      '    slug: "variant-three",',
      '  },',
      '];',
    ].join('\n'),
  ]]);
  const plan = (evidence: { file: string; line?: number; quote: string }[]) => ({ steps: [], structured: { rootCause: { explanation: 'x', evidence } } });

  it('does not misreport the line when the cited line is one of the occurrences', () => {
    const check = checkPlanClaims(entries, plan([{ file: 'data/entries.ts', line: 11, quote: 'group: "core",' }]));
    expect(check.verified).toEqual([{ evidence: expect.anything(), occurrences: 4, ambiguous: false }]);
    expect(check.issues).toEqual([]);
    expect(automaticPlanSections({ check, readers: [], dataStoreNotes: [] })).not.toContain('not 11');
  });

  it('when the cited line is off, reports the nearest occurrence, not the first', () => {
    const check = checkPlanClaims(entries, plan([{ file: 'data/entries.ts', line: 12, quote: 'group: "core",' }]));
    expect(check.verified[0]).toMatchObject({ occurrences: 4, ambiguous: false });
    const off = checkPlanClaims(entries, plan([{ file: 'data/entries.ts', line: 30, quote: 'group: "core",' }]));
    expect(off.verified[0]).toMatchObject({ actualLine: 15, ambiguous: true });
    expect(automaticPlanSections({ check: off, readers: [], dataStoreNotes: [] })).toContain('nearest to the cited line 30 is line 15');
  });

  it('asks for a line number or a distinguishing neighbour when a repeated quote has no usable line', () => {
    const check = checkPlanClaims(entries, plan([{ file: 'data/entries.ts', quote: 'group: "core",' }]));
    expect(check.verified[0]).toMatchObject({ occurrences: 4, ambiguous: true });
    expect(check.issues[0]).toContain('appears 4 times in data/entries.ts');
    expect(check.issues[0]).toContain('two lines that include one only this entry has');
  });

  it('accepts a multi-line quote that pins down one entry', () => {
    const check = checkPlanClaims(entries, plan([{ file: 'data/entries.ts', quote: 'group: "core",\n    slug: "variant-two",' }]));
    expect(check.verified[0]).toMatchObject({ occurrences: 1, ambiguous: false });
    expect(check.issues).toEqual([]);
    expect(checkPlanClaims(entries, plan([{ file: 'data/entries.ts', quote: 'group: "core",\n    slug: "missing",' }])).unverified).toHaveLength(1);
  });
});

describe('reader coverage', () => {
  // Readers shaped like a real shared data file: scripts, admin API routes, a launcher route, admin pages.
  const readers = [{
    file: 'lib/data/editions.ts',
    usedBy: ['scripts/gen-chips.ts', 'scripts/seed-editions.ts', 'scripts/sync-install.ts', 'app/api/admin/editions/materialize/route.ts', 'app/api/admin/editions/reorder/route.ts'],
    routes: ['/api/admin/editions/materialize', '/api/admin/editions/reorder', '/api/launcher/catalog', '/admin/games/:slug/editions'],
  }];
  const groups = groupReaders(readers);

  it('groups many readers by folder and route prefix so a plan can answer for them together', () => {
    expect(groups.map((g) => g.label)).toEqual(['scripts', 'app/api/admin/editions', 'route /api/admin/editions', 'route /api/launcher/catalog', 'route /admin/games/editions']);
    expect(groups[0].files).toHaveLength(3);
  });

  it('finds readers a plan never mentions, and words the fix as an instruction', () => {
    const plan = { structured: { sideEffects: ['Nothing else is affected.'] } };
    const missing = unaddressedReaders(groups, plan);
    expect(missing).toHaveLength(groups.length);
    const issue = readerCoverageIssues(missing)[0];
    expect(issue).toContain('other code reads the files you change');
    expect(issue).toContain('scripts (gen-chips.ts, seed-editions.ts, sync-install.ts)');
    expect(readerCoverageIssues([])).toEqual([]);
  });

  it('counts a reader as answered when the plan names its file, folder, base name or route', () => {
    const plan = { structured: { sideEffects: [
      'scripts/gen-chips.ts must be re-run to regenerate the chips.',
      'The admin editions API routes under /api/admin/editions read the seed and are unaffected.',
      'The launcher catalog route /api/launcher/catalog will stop listing the edition (intended).',
      'The /admin/games/editions pages show the edition list and are unaffected.',
      'app/api/admin/editions routes (materialize and reorder) are unaffected.',
    ] } };
    expect(unaddressedReaders(groups, plan).map((g) => g.label)).toEqual([]);
    const partial = { structured: { sideEffects: ['The launcher catalog route /api/launcher/catalog is affected.'] } };
    expect(unaddressedReaders(groups, partial).map((g) => g.label)).not.toContain('route /api/launcher/catalog');
    expect(unaddressedReaders(groups, partial).map((g) => g.label)).toContain('scripts');
  });

  it('shows what the plan left unanswered in the automatic section', () => {
    const missing = unaddressedReaders(groups, { structured: { sideEffects: [] } });
    const text = automaticPlanSections({ check: checkPlanClaims(new Map(), { steps: [] }), readers: [], dataStoreNotes: [], unaddressed: missing.slice(0, 1) });
    expect(text).toContain('The plan does not say how the change affects: scripts (gen-chips.ts, seed-editions.ts, sync-install.ts).');
  });
});

describe('automatic sections', () => {
  it('summarises what was verified and lists other readers and unverifiable data, from the repository', () => {
    const plan = { steps: ['Edit lib/data/variants.ts'], structured: { filesToChange: ['lib/data/variants.ts'], rootCause: { explanation: 'x', evidence: [
      { file: 'lib/data/variants.ts', line: 2, quote: "{ parent: 'widget', slug: 'gadgetPro' }," }, { file: 'lib/data/variants.ts', quote: 'this line is made up entirely' },
    ] } } };
    const check = checkPlanClaims(files, plan, opts);
    const readers = readersOfPlannedFiles(files, ['lib/data/variants.ts'], { ...opts, pageRoute: pack.page!.route });
    expect(readers).toEqual([{ file: 'lib/data/variants.ts', usedBy: ['app/shop/[slug]/page.tsx'], routes: ['/shop/:slug'] }]);
    const text = automaticPlanSections({ check, readers, dataStoreNotes: [{ file: 'a/route.ts', line: 10, text: 'Variant.find({})', note: 'reads from a database' }] });
    expect(text).toContain('## Automatic checks (from the repository)');
    expect(text).toContain('1 of 2 quoted lines were found');
    expect(text).toContain('lib/data/variants.ts is also used by app/shop/[slug]/page.tsx, route /shop/:slug');
    expect(text).toContain('Not verifiable from the repository: a/route.ts:10 reads from a database');
    expect(automaticPlanSections({ check: checkPlanClaims(files, { steps: [] }), readers: [], dataStoreNotes: [] })).toBe('');
  });
});
