import { describe, expect, it } from 'vitest';
import { buildEvidencePack } from './evidencePack';
import { planTemplate, planTemplateRequest } from './planTemplate';
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
