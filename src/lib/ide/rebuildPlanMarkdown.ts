import type { IdePlanDocument } from '@/lib/ide/idePlan';

/**
 * Rebuild plan markdown from editable fields for Approve & Build. The sections after the steps (symptom,
 * code path, root cause with evidence, side effects, unverified items...) are kept as they were: only the
 * title, summary and steps are editable.
 */
export function rebuildIdePlanMarkdown(plan: Pick<IdePlanDocument, 'title' | 'summary' | 'steps'> & { markdown?: string }): string {
  const tailAt = plan.markdown ? plan.markdown.indexOf('\n## ') : -1;
  const tail = tailAt >= 0 ? plan.markdown!.slice(tailAt).trim() : '';
  const parts = [
    `# ${plan.title.trim() || 'Plan'}`,
    plan.summary.trim() ? plan.summary.trim() : '',
    plan.steps.length
      ? plan.steps
          .map((step) => step.trim())
          .filter(Boolean)
          .map((step, index) => `${index + 1}. ${step}`)
          .join('\n')
      : '',
    tail,
  ].filter(Boolean);
  return parts.join('\n\n').slice(0, 24000);
}

export function withRebuiltPlanMarkdown(plan: IdePlanDocument): IdePlanDocument {
  return {
    ...plan,
    title: plan.title.slice(0, 200),
    summary: plan.summary.slice(0, 2000),
    steps: plan.steps.map((step) => step.slice(0, 500)),
    markdown: rebuildIdePlanMarkdown(plan),
  };
}
