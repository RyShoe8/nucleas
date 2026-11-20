import { jobRunOutputSchema, type JobDesign } from './schema';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Structural recovery only. Supplied URLs and claims still go through the usual evidence checks. */
function signatureRecord(raw: unknown): unknown {
  if (!object(raw)) return raw;
  const input = object(raw.values) ? raw.values : raw;
  const values = { ...input };
  const aliases: Record<string, string[]> = {
    company: ['name'], role: ['person_role'], email: ['contact_email'], logo: ['logo_url'],
    social: ['bluesky_profile'], preset: ['layout'], cta_label: ['cta_text'], post: ['social_draft'],
  };
  for (const [key, names] of Object.entries(aliases)) {
    if (values[key] !== undefined) continue;
    const alias = names.find(name => input[name] !== undefined);
    if (alias) values[key] = input[alias];
  }
  // A named citation map is already a list of supplied sources, not something to ask a model to rewrite.
  const sources = object(raw.sources) && !('url' in raw.sources) ? Object.values(raw.sources) : raw.sources;
  if (object(raw.sources)) for (const key of ['team_source', 'growth_source', 'person_source', 'contact_source', 'feed', 'cta_url']) {
    if (values[key] === undefined && typeof raw.sources[key] === 'string') values[key] = raw.sources[key];
  }
  for (const key of ['values', 'sources', 'summary', 'gaps', 'screened']) delete values[key];
  return { values, sources };
}

/** Workers sometimes use the displayed field labels. Map only declared labels/keys, never guessed meanings. */
function namedFields(raw: unknown, fields: JobDesign['fields']): unknown {
  if (!object(raw)) return raw;
  const input = object(raw.values) ? raw.values : raw;
  const values = { ...input };
  const keyFor = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const field of fields) {
    if (values[field.key] !== undefined) continue;
    const alias = Object.keys(input).find(key => keyFor(key) === keyFor(field.key) || keyFor(key) === keyFor(field.label));
    if (alias) values[field.key] = input[alias];
  }
  const sources = object(raw.sources) && !('url' in raw.sources) ? Object.values(raw.sources) : raw.sources;
  for (const key of ['values', 'sources', 'summary', 'gaps', 'screened']) delete values[key];
  return { values, sources };
}

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
export function parseJobOutput(text: string, skill?: JobDesign['skill'], fields: JobDesign['fields'] = []) {
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
    if (skill === 'signature_outreach' && object(raw)) {
      if (Array.isArray(raw.records)) raw = { ...raw, records: raw.records.map(signatureRecord) };
      else if (object(raw.values) || (typeof raw.website === 'string' && (raw.company || raw.name))) {
        raw = { records: [signatureRecord(raw)], summary: raw.summary ?? '', gaps: raw.gaps ?? [], screened: raw.screened };
      }
    }
    if (object(raw) && fields.length && Array.isArray(raw.records)) raw = { ...raw, records: raw.records.map(record => namedFields(record, fields)) };
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
