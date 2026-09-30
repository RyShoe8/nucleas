import { describe, expect, it } from 'vitest';
import { automaticPlanSections, checkPlanClaims, readersOfPlannedFiles } from './claimCheck';
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
