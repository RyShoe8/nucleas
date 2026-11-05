import { jobRunOutputSchema, type JobDesign } from './schema';

/** Separate complete top-level objects when the worker mixes prose, examples and the final result. */
function objectBlocks(text: string): string[] {
  const blocks: string[] = [];
  let start = 0, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (depth && char === '"') quoted = true;
    else if (char === '{') { if (!depth) start = i; depth++; }
    else if (char === '}' && depth && --depth === 0) blocks.push(text.slice(start, i + 1));
  }
  return blocks.reverse();
}

export function replyProblem(text: string): string {
  const visible = text.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
  if (!visible) return 'The model returned no final answer.';
  if (!/[{[]/.test(visible)) return 'The model returned prose without a JSON record.';
  return 'The model returned incomplete JSON or a record with invalid fields.';
}

/** Accept common response envelopes without inventing records, values, or evidence. */
export function parseJobOutput(text: string, skill?: JobDesign['skill']) {
  const clean = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim();
  const candidates = [clean, ...Array.from(clean.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (m) => m[1])];
  if (skill === 'marketing_plan') candidates.push(...objectBlocks(clean));
  const start = clean.indexOf('{');
  if (start >= 0) candidates.push(clean.slice(start, clean.lastIndexOf('}') + 1));
  let result = jobRunOutputSchema.safeParse(null);
  for (const candidate of candidates) {
    let raw: unknown;
    try { raw = JSON.parse(candidate); if (typeof raw === 'string') raw = JSON.parse(raw); } catch { continue; }
    if (Array.isArray(raw)) raw = { records: raw };
    if (raw && typeof raw === 'object') {
      const value = raw as Record<string, unknown>;
      // Some workers return the requested Voice field at the root instead of in values.
      if (skill === 'brand_voice' && !value.records && (value.brand_profile || (value.positioning && value.audienceRelationship && value.rhetoricalPatterns))) {
        raw = { records: [{ values: { brand_profile: value.brand_profile ?? value }, sources: value.sources ?? [] }], summary: value.summary ?? '', gaps: value.gaps ?? [] };
      }
    }
    result = jobRunOutputSchema.safeParse(raw);
    if (result.success) return result;
  }
  return result;
}

export function manualArtifact(skill?: JobDesign['skill']) {
  return skill === 'brand_voice' || skill === 'marketing_plan';
}
