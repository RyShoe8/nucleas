import type { IdePlanDocument } from '@/lib/ide/idePlan';
import { parseStructuredPlan, renderStructuredSections, type StructuredPlan } from '@/lib/ide/planStructure';

/** The plan document as markdown: title, summary, steps, the structured sections, Nucleas's own sections, then details. */
export function composePlanMarkdown(parts: { title: string; summary: string; steps: string[]; structured?: StructuredPlan; details?: string; extraSections?: string; notFound?: Set<string> }): string {
  return [
    `# ${parts.title}`,
    parts.summary,
    parts.steps.length ? parts.steps.map((step, index) => `${index + 1}. ${step}`).join('\n') : '',
    renderStructuredSections(parts.structured, { notFound: parts.notFound }),
    parts.extraSections ?? '',
    parts.details ? `## Details & Architecture\n\n${parts.details}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 24000);
}

/** Adds Nucleas's own sections to a plan and marks quotes that were not found, keeping everything else. */
export function recomposePlan(plan: IdePlanDocument, options: { extraSections?: string; notFound?: Set<string> }): IdePlanDocument {
  return { ...plan, markdown: composePlanMarkdown({ title: plan.title, summary: plan.summary === plan.title ? '' : plan.summary, steps: plan.steps, structured: plan.structured, details: plan.details, ...options }) };
}

const FENCE_RE = /```nucleas-plan\s*([\s\S]*?)```/i;
const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);
}

/**
 * Extract a nucleas-plan JSON fence from model output.
 * Returns null when missing or invalid (caller keeps plain chat text).
 */
export function parseNucleasPlan(raw: string): {
  plan: IdePlanDocument;
  displayText: string;
} | null {
  const tagged = raw.match(FENCE_RE);
  const generic = tagged ? null : raw.match(JSON_FENCE_RE);
  const trimmed = raw.trim();
  const bare = !tagged && !generic && trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : null;
  const payload = tagged?.[1] ?? generic?.[1] ?? bare;
  if (!payload) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  const steps = asStringArray(record.steps);
  if (!title || (!summary && steps.length === 0)) return null;

  const withoutFence = tagged
    ? raw.replace(tagged[0], '').trim()
    : generic
      ? raw.replace(generic[0], '').trim()
      : '';
  const displayText =
    withoutFence ||
    'Plan ready to review in the center pane. Approve it when you want me to build.';

  const structured = parseStructuredPlan(record);

  return {
    plan: {
      title: title.slice(0, 200),
      summary: (summary || title).slice(0, 2000),
      steps: steps.map((step) => step.slice(0, 500)),
      markdown: composePlanMarkdown({ title, summary, steps, structured, details: withoutFence }),
      status: 'ready_for_review',
      ...(structured ? { structured } : {}),
      ...(withoutFence ? { details: withoutFence } : {}),
    },
    displayText: displayText.slice(0, 24000),
  };
}
