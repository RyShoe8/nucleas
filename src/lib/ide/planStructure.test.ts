import { describe, expect, it } from 'vitest';
import { parseNucleasPlan } from '@/lib/ide/parseNucleasPlan';
import { plannedFiles, parseStructuredPlan, renderStructuredSections, validatePlanStructure } from '@/lib/ide/planStructure';
import { rebuildIdePlanMarkdown } from '@/lib/ide/rebuildPlanMarkdown';

const full = {
  title: 'Hide duplicate variant row',
  summary: 'The admin list shows gadgetPro twice.',
  steps: ['In app/api/admin/catalog/items/route.ts skip variants that are also top-level items'],
  symptom: 'gadgetPro appears on its own and under widget on /admin/catalog.',
  path: [{ file: 'app/admin/catalog/page.tsx', line: 1, note: 'renders the panel' }, 'app/api/admin/catalog/items/route.ts:8 builds the rows'],
  rootCause: {
    explanation: '1. The route adds a row per item. 2. It then adds a row per variant of each item. 3. gadgetPro is both.',
    evidence: [{ file: 'lib/data/variants.ts', line: 2, quote: "{ parent: 'widget', slug: 'gadgetPro' }," }, "app/api/admin/catalog/items/route.ts:8 `rows.push({ key: `${item.slug}:${v.slug}` })`"],
  },
  filesToChange: ['app/api/admin/catalog/items/route.ts'],
  walkthrough: 'app/api/admin/catalog/items/route.ts GET(): with the change the loop over variants skips gadgetPro, so it pushes one row for it instead of two.',
  expectedResult: 'Only one gadgetPro row remains because the variant loop at route.ts:8 skips it.',
  sideEffects: ['lib/data/variants.ts also feeds /shop/:slug; it is not edited.'],
  unverified: ['Stored variants in the database may still contain widget:gadgetPro.'],
  outOfScope: [],
};

describe('parseStructuredPlan', () => {
  it('reads objects and the loose strings small models write, and keeps empty lists as "none"', () => {
    const s = parseStructuredPlan(full)!;
    expect(s.path).toEqual([
      { file: 'app/admin/catalog/page.tsx', line: 1, note: 'renders the panel' },
      { file: 'app/api/admin/catalog/items/route.ts', line: 8, note: 'builds the rows' },
    ]);
    expect(s.rootCause?.evidence).toEqual([
      { file: 'lib/data/variants.ts', line: 2, quote: "{ parent: 'widget', slug: 'gadgetPro' }," },
      { file: 'app/api/admin/catalog/items/route.ts', line: 8, quote: 'rows.push({ key: `${item.slug}:${v.slug}` })' },
    ]);
    expect(s.outOfScope).toEqual([]);
  });

  it('accepts snake_case, a string root cause, and returns undefined when there is nothing', () => {
    expect(parseStructuredPlan({ root_cause: 'Because.', files_to_change: ['a/b.ts:3'], expected_result: 'Fixed.' })).toMatchObject({
      rootCause: { explanation: 'Because.', evidence: [] }, filesToChange: ['a/b.ts'], expectedResult: 'Fixed.',
    });
    expect(parseStructuredPlan({ title: 'x', steps: [] })).toBeUndefined();
  });
});

describe('validatePlanStructure', () => {
  const plan = parseNucleasPlan(`\`\`\`nucleas-plan\n${JSON.stringify(full)}\n\`\`\``)!.plan;

  it('accepts a complete plan', () => {
    expect(validatePlanStructure(plan, { hasKnownPath: true })).toEqual([]);
  });

  it('says exactly what is missing, in words that can be sent back to the model', () => {
    const bare = validatePlanStructure({ steps: ['Do it'] });
    expect(bare).toHaveLength(1);
    expect(bare[0]).toContain('rootCause');
    const partial = validatePlanStructure({ steps: ['Fix it'], structured: { symptom: 'x', rootCause: { explanation: 'because', evidence: [] } } }, { hasKnownPath: true });
    expect(partial.join('\n')).toMatch(/path: .*Data path/);
    expect(partial.join('\n')).toMatch(/rootCause\.evidence: quote the code/);
    expect(partial.join('\n')).toContain('filesToChange');
    expect(partial.join('\n')).toContain('walkthrough');
    expect(partial.join('\n')).toContain('expectedResult');
    expect(partial.join('\n')).toContain('sideEffects');
    expect(partial.join('\n')).toContain('unverified');
    expect(partial.join('\n')).toContain('outOfScope');
  });

  it('rejects plans padded with steps that only verify or restate the goal', () => {
    const padded = { ...plan, steps: ['Verify the change works', 'Ensure nothing else breaks', 'Check the page', 'Edit app/api/x/route.ts to skip the duplicate'] };
    expect(validatePlanStructure(padded, { hasKnownPath: true }).join('\n')).toContain('only verify or restate the goal');
    const fine = { ...plan, steps: ['Edit app/api/x/route.ts to skip the duplicate', 'Verify app/api/x/route.ts returns one row'] };
    expect(validatePlanStructure(fine, { hasKnownPath: true })).toEqual([]);
  });
});

describe('plan documents', () => {
  it('renders the structured sections into the plan markdown, after the steps', () => {
    const { plan } = parseNucleasPlan(`\`\`\`nucleas-plan\n${JSON.stringify(full)}\n\`\`\``)!;
    expect(plan.markdown).toMatch(/^# Hide duplicate variant row[\s\S]*1\. In app\/api[\s\S]*## Symptom[\s\S]*## Code path[\s\S]*## Root cause[\s\S]*Evidence:[\s\S]*## Files to change/);
    expect(plan.markdown).toContain("`lib/data/variants.ts:2`: `{ parent: 'widget', slug: 'gadgetPro' },`");
    expect(plan.markdown).toContain('## Unverified');
    expect(renderStructuredSections(undefined)).toBe('');
  });

  it('keeps those sections when an approver edits the title, summary or steps', () => {
    const { plan } = parseNucleasPlan(`\`\`\`nucleas-plan\n${JSON.stringify(full)}\n\`\`\``)!;
    const edited = rebuildIdePlanMarkdown({ ...plan, title: 'Better title', steps: ['New step one', 'New step two'] });
    expect(edited).toContain('# Better title');
    expect(edited).toContain('2. New step two');
    expect(edited).toContain('## Root cause');
    expect(edited).toContain('## Unverified');
    expect(edited).not.toContain('In app/api/admin/catalog/items/route.ts skip variants');
    // Rebuilding again changes nothing.
    expect(rebuildIdePlanMarkdown({ ...plan, title: 'Better title', steps: ['New step one', 'New step two'], markdown: edited })).toBe(edited);
  });

  it('lists the files a plan will touch from its field and from paths in its steps', () => {
    expect(plannedFiles({ steps: ['Edit src/a.ts and update docs/readme.md'], structured: { filesToChange: ['src/b.ts'] } })).toEqual(['src/b.ts', 'src/a.ts', 'docs/readme.md']);
  });
});

describe('recomposing a plan', () => {
  it('adds Nucleas\'s own sections and marks quotes that were not found, keeping the model\'s details', async () => {
    const { recomposePlan } = await import('@/lib/ide/parseNucleasPlan');
    const raw = `Some explanation the model wrote about a tradeoff that the JSON fields do not cover.\n\`\`\`nucleas-plan\n${JSON.stringify(full)}\n\`\`\``;
    const { plan } = parseNucleasPlan(raw)!;
    const next = recomposePlan(plan, { extraSections: '## Automatic checks (from the repository)\n\n- 1 of 2 quoted lines were found.', notFound: new Set(["{ parent: 'widget', slug: 'gadgetPro' },"]) });
    expect(next.markdown).toContain("`lib/data/variants.ts:2`: `{ parent: 'widget', slug: 'gadgetPro' },` — ⚠ not found in the repository");
    expect(next.markdown).toContain('## Automatic checks (from the repository)');
    expect(next.markdown).toContain('## Details & Architecture\n\nSome explanation the model wrote about a tradeoff');
    // The automatic section sits after the structured ones and before the free text.
    expect(next.markdown.indexOf('## Unverified')).toBeLessThan(next.markdown.indexOf('## Automatic checks'));
    expect(next.markdown.indexOf('## Automatic checks')).toBeLessThan(next.markdown.indexOf('## Details & Architecture'));
    expect(plan.markdown).not.toContain('not found in the repository');
  });
});

describe('walkthrough', () => {
  it('is required, must name code, and renders as its own section', () => {
    const base = { steps: ['Edit src/a.ts'], structured: { ...(parseStructuredPlan(full)!), walkthrough: undefined } };
    expect(validatePlanStructure(base, { hasKnownPath: true }).join('\n')).toContain('walkthrough: step through the code');
    const vague = { ...base, structured: { ...base.structured, walkthrough: 'It should work fine after the edit is applied here.' } };
    expect(validatePlanStructure(vague, { hasKnownPath: true }).join('\n')).toContain('name the file and function');
    const good = { ...base, structured: { ...base.structured, walkthrough: 'src/list.ts buildRows(): with the change the loop skips X, so it outputs one row.' } };
    expect(validatePlanStructure(good, { hasKnownPath: true })).toEqual([]);
    expect(renderStructuredSections(good.structured)).toContain('## Walkthrough with the change applied\n\nsrc/list.ts buildRows()');
  });
});

describe('prose that only repeats the plan', () => {
  it('is not kept as Details, while genuinely new prose and wireframes are', async () => {
    const { proseBeyondThePlan } = await import('@/lib/ide/parseNucleasPlan');
    const plan = { title: 'Hide duplicate variant row', summary: 'gadgetPro is listed twice', steps: ['Edit lib/data/variants.ts to remove the gadgetPro entry under widget'] };
    const repeated = 'Plan\nHide duplicate variant row\n1. Edit lib/data/variants.ts to remove the gadgetPro entry under widget\nExpected Result';
    expect(proseBeyondThePlan(repeated, plan)).toBe('');
    expect(proseBeyondThePlan(`${repeated}\nThe seed file is shared, so the public shop page is affected as well.`, plan)).toBe('The seed file is shared, so the public shop page is affected as well.');
    expect(proseBeyondThePlan('+---------+\n|  Header |\n+---------+', plan)).toContain('| Header |'.replace('| H', '|  H'));
  });
});
