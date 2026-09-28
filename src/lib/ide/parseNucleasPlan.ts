import type { IdePlanDocument } from '@/lib/ide/idePlan';

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

  const markdownParts = [
    `# ${title}`,
    summary ? summary : '',
    steps.length ? steps.map((step, index) => `${index + 1}. ${step}`).join('\n') : '',
    withoutFence ? `## Details & Architecture\n\n${withoutFence}` : '',
  ].filter(Boolean);

  return {
    plan: {
      title: title.slice(0, 200),
      summary: (summary || title).slice(0, 2000),
      steps: steps.map((step) => step.slice(0, 500)),
      markdown: markdownParts.join('\n\n').slice(0, 24000),
      status: 'ready_for_review',
    },
    displayText: displayText.slice(0, 24000),
  };
}
