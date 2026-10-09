import { jobRunOutputSchema, type JobDesign } from './schema';

/** Accept common response envelopes without inventing records, values, or evidence. */
export function parseJobOutput(text: string, skill?: JobDesign['skill']) {
  const clean = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim();
  const candidates = [clean, ...Array.from(clean.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (m) => m[1])];
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
