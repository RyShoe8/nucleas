import { describe, expect, it } from 'vitest';
import { buildEvidencePack } from './evidencePack';

const project = (entries: Record<string, string>) => new Map(Object.entries(entries));

// A page lists items and their variants. The route that builds the list never names any product: it loops
// over data. The variant data lives in a seed file that also feeds a public page.
const files = project({
  'package.json': '{"dependencies":{"next":"14"}}',
  'app/admin/catalog/page.tsx': "import Panel from '@/components/Panel';\nexport default function Page() { return <Panel /> }",
  'components/Panel.tsx': "'use client';\nexport default function Panel() {\n  useEffect(() => { fetch('/api/admin/catalog/items').then(r => r.json()) }, []);\n  return null;\n}",
  'app/api/admin/catalog/items/route.ts': [
    "import { ITEMS } from '@/lib/catalog';",
    "import { seedVariants } from '@/lib/data/variants';",
    "import { Variant } from '@/models/Variant';",
    'export async function GET() {',
    '  const rows = [];',
    '  for (const item of ITEMS) {',
    '    rows.push({ key: item.slug });',
    '    for (const v of seedVariants.filter((s) => s.parent === item.slug)) rows.push({ key: `${item.slug}:${v.slug}` });',
    '  }',
    '  const stored = await Variant.find({});',
    '  return Response.json(rows.concat(stored));',
    '}',
  ].join('\n'),
  'lib/catalog.ts': "export const ITEMS = [{ slug: 'widget' }, { slug: 'gadgetPro' }];",
  'lib/data/variants.ts': "export const seedVariants = [\n  { parent: 'widget', slug: 'gadgetPro' },\n];",
  'app/shop/[slug]/page.tsx': "import { seedVariants } from '@/lib/data/variants';\nexport default function Shop() { return null }",
  'models/Variant.ts': 'export const Variant = {};',
  'lib/unrelated.ts': 'export const x = 1;',
});

const request = 'On example.com/admin/catalog, gadgetPro is listed on its own and also under widget. Remove the listing under widget.';

describe('buildEvidencePack', () => {
  const pack = buildEvidencePack(files, request)!;

  it('finds the page and the data path through the file that never names the product', () => {
    expect(pack.page).toEqual({ file: 'app/admin/catalog/page.tsx', route: '/admin/catalog' });
    const chain = pack.chains.find((c) => c.target === 'lib/data/variants.ts')!;
    expect(chain.hops.map((h) => h.file)).toEqual([
      'app/admin/catalog/page.tsx', 'components/Panel.tsx', 'app/api/admin/catalog/items/route.ts', 'lib/data/variants.ts',
    ]);
  });

  it('cites the line that connects each hop', () => {
    const hops = pack.chains.find((c) => c.target === 'lib/data/variants.ts')!.hops;
    expect(hops[1].via).toMatchObject({ file: 'app/admin/catalog/page.tsx', line: 1 });
    expect(hops[2].via).toMatchObject({ file: 'components/Panel.tsx', line: 3 });
    expect(hops[2].via?.text).toContain("fetch('/api/admin/catalog/items')");
    expect(hops[3].via).toMatchObject({ file: 'app/api/admin/catalog/items/route.ts', line: 2 });
  });

  it('quotes the lines that mention the names, with line numbers', () => {
    expect(pack.termLines).toContainEqual({ file: 'lib/data/variants.ts', line: 2, text: "{ parent: 'widget', slug: 'gadgetPro' },", term: 'gadgetpro' });
  });

  it('flags data the repository cannot show, and other readers of the data file', () => {
    expect(pack.unverified).toEqual([expect.objectContaining({ file: 'app/api/admin/catalog/items/route.ts', line: 10, note: 'reads from a database' })]);
    const readers = pack.readers.find((r) => r.file === 'lib/data/variants.ts')!;
    // Only consumers outside the page's own path: the assembler route on that path is not listed.
    expect(readers.usedBy).toEqual(['app/shop/[slug]/page.tsx']);
    expect(readers.routes).toContain('/shop/:slug');
  });

  it('puts the assembler file in focus, centred on the line where it uses the data', () => {
    expect(pack.focus.map((f) => f.file)).toContain('app/api/admin/catalog/items/route.ts');
    // Not the import line, but where the imported data is first used to build rows.
    const line = pack.focus.find((f) => f.file === 'app/api/admin/catalog/items/route.ts')?.line;
    expect(line).toBeGreaterThan(3);
    expect(files.get('app/api/admin/catalog/items/route.ts')!.split('\n')[line! - 1]).toMatch(/ITEMS|seedVariants/);
  });

  it('renders a block a model can quote from', () => {
    expect(pack.text).toContain('Data path to lib/data/variants.ts:');
    expect(pack.text).toContain('lib/data/variants.ts:2:');
    expect(pack.text).toContain('lib/data/variants.ts is also used by: app/shop/[slug]/page.tsx, route /shop/:slug');
    expect(pack.text).toContain('Not verifiable from the repository: app/api/admin/catalog/items/route.ts:10');
  });

  it('still helps when no page is named, and returns null when nothing matches', () => {
    const noPage = buildEvidencePack(files, 'gadgetPro is listed twice')!;
    expect(noPage.page).toBeNull();
    expect(noPage.termLines.map((l) => l.file)).toContain('lib/data/variants.ts');
    expect(buildEvidencePack(files, 'make it nicer')).toBeNull();
  });
});
