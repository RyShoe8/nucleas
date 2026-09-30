import { describe, expect, it } from 'vitest';
import { buildEvidencePack } from './evidencePack';
import { planTemplate, planTemplateRequest } from './planTemplate';
import { lookupTargetIssues } from './claimCheck';
import { parseNucleasPlan } from '@/lib/ide/parseNucleasPlan';

const files = new Map<string, string>(Object.entries({
  'package.json': '{"dependencies":{"next":"14"}}',
  'app/admin/catalog/page.tsx': "import Panel from '@/components/Panel';\nexport default function Page() { return <Panel /> }",
  'components/Panel.tsx': "export default function Panel() { fetch('/api/admin/catalog/items'); return null }",
  'app/api/admin/catalog/items/route.ts': "import { seedVariants } from '@/lib/data/variants';\nexport async function GET() {\n  return Response.json(seedVariants.map((v) => v.slug));\n}",
  'lib/data/variants.ts': "export const seedVariants = [\n  { parent: 'widget', slug: 'gadgetPro' },\n];",
}));

describe('structure facts in the evidence pack', () => {
  it('says which object each quoted line belongs to, so the structure is not guessed', () => {
    const pack = buildEvidencePack(files, 'On example.com/admin/catalog, gadgetPro is listed on its own and also under widget.')!;
    expect(pack.text).toContain('Structure around those lines');
    expect(pack.text).toContain("is inside one object");
    expect(pack.text).toContain("parent: 'widget'");
  });
});

describe('planTemplate', () => {
  const pack = buildEvidencePack(files, 'On example.com/admin/catalog, gadgetPro is listed on its own and also under widget. Remove the listing under widget.');

  it('pre-fills the traced path and real quotable lines', () => {
    const template = JSON.parse(planTemplate(pack));
    expect(template.path.map((p: { file: string }) => p.file)).toContain('app/admin/catalog/page.tsx');
    expect(template.rootCause.evidence.some((e: { quote: string }) => e.quote.includes('gadgetPro'))).toBe(true);
  });

  it('is a valid plan shape once the placeholders are replaced, and works with no pack', () => {
    expect(planTemplateRequest('fix it', pack)).toContain('```nucleas-plan');
    expect(() => JSON.parse(planTemplate(null))).not.toThrow();
    expect(parseNucleasPlan(`\`\`\`nucleas-plan\n${planTemplate(pack)}\n\`\`\``)?.plan.title).toBe('<short title>');
  });
});

describe('ranking files that define what is listed', () => {
  // The route reads a lookup table (lowercase keys) and the data the page lists (displayed names).
  const repo = new Map<string, string>(Object.entries({
    'package.json': '{"dependencies":{"next":"14"}}',
    'app/admin/connect/game-servers/page.tsx': "import Manager from '@/components/Manager';\nexport default function Page() { return <Manager /> }",
    'components/Manager.tsx': "export default function Manager() { fetch('/api/admin/connect/game-servers/hosting'); return null }",
    'app/api/admin/connect/game-servers/hosting/route.ts': "import { queryKind } from '@/lib/communityHosting/playerQuery';\nimport { editions } from '@/lib/data/editions';\nexport async function GET() { return Response.json(editions.map((e) => ({ key: `${e.gameSlug}:${e.slug}`, q: queryKind(e.slug) }))) }",
    'lib/communityHosting/playerQuery.ts': 'const KIND = {\n  openra: "openra-master",\n  openhv: "openra-master",\n};\nexport const queryKind = (s: string) => KIND[s];',
    'lib/data/editions.ts': 'export const editions = [\n  {\n    gameSlug: "openra",\n    slug: "openhv",\n    name: "OpenHV",\n    description: "OpenHV is built on OpenRA",\n  },\n];',
  }));

  it('puts the file holding the displayed names ahead of a lookup table that sorts first alphabetically', () => {
    const pack = buildEvidencePack(repo, 'On example.com/admin/connect/game-servers, OpenHV is listed on its own and also under OpenRA as an edition. Remove the edition listing under OpenRA.')!;
    expect(pack.chains[0].target).toBe('lib/data/editions.ts');
    expect(pack.text).toContain('mention the names only as lowercase keys');
    expect(pack.lookupOnly).toEqual(['lib/communityHosting/playerQuery.ts']);
    expect(pack.displayFiles).toEqual(['lib/data/editions.ts']);
  });

  it('flags a plan that changes only the lookup table and quotes nothing from the file holding the displayed names', () => {
    const pack = buildEvidencePack(repo, 'On example.com/admin/connect/game-servers, OpenHV is listed on its own and also under OpenRA as an edition.')!;
    const lookup = { steps: ['Edit lib/communityHosting/playerQuery.ts'], structured: { filesToChange: ['lib/communityHosting/playerQuery.ts'], rootCause: { explanation: 'x', evidence: [{ file: 'lib/communityHosting/playerQuery.ts', quote: 'openhv: "openra-master",' }] } } };
    expect(lookupTargetIssues(pack, lookup)[0]).toContain('lowercase lookup keys');
    // Changing the displayed-name file, or quoting it, is fine; so is having no displayed-name file at all.
    expect(lookupTargetIssues(pack, { steps: ['Edit lib/data/editions.ts'], structured: { filesToChange: ['lib/data/editions.ts'] } })).toEqual([]);
    expect(lookupTargetIssues(pack, { ...lookup, structured: { ...lookup.structured, rootCause: { explanation: 'x', evidence: [{ file: 'lib/data/editions.ts', quote: 'slug: "openhv",' }] } } })).toEqual([]);
    expect(lookupTargetIssues({ lookupOnly: ['a.ts'], displayFiles: [] }, { steps: ['Edit a.ts'], structured: { filesToChange: ['a.ts'] } })).toEqual([]);
  });
});
