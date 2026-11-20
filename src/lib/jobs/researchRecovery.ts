import type { JobRunOutput } from './schema';

type RecordResult = JobRunOutput['records'][number];
const present = (value: unknown) => value !== undefined && value !== null && value !== '';
const website = (record: RecordResult) => {
  try {
    const url = new URL(String(record.values.website));
    return `${url.protocol}//${url.host.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
  } catch { return null; }
};
const recent = (value: unknown, now: number) => {
  const date = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(date) && date <= now + 86400000 && date >= now - 366 * 86400000;
};

/** Keep missing fields on a repair of the same prospect. These remain claims, never verified facts. */
export function preserveCandidateEvidence(previous: JobRunOutput, next: JobRunOutput, now = Date.now()): JobRunOutput {
  if (previous.records.length !== 1 || next.records.length !== 1) return next;
  const before = previous.records[0], after = next.records[0];
  const priorSite = website(before), nextSite = website(after);
  // An unidentified reply cannot replace a known candidate. Different companies must never share fields.
  if (!nextSite) return previous;
  if (!priorSite || priorSite !== nextSite) return next;
  const values = { ...before.values, ...Object.fromEntries(Object.entries(after.values).filter(([, value]) => present(value))) };
  // Keep related evidence together. A new source cannot inherit an old page's quotation or date.
  for (const group of [
    ['team_source', 'team_quote', 'team_size', 'team_evidence'],
    ['growth_source', 'growth_quote', 'growth_date', 'growth_evidence'],
    ['person_source', 'first_name', 'last_name', 'role'],
    ['contact_source', 'email'],
  ]) {
    const source = group[0];
    if (present(after.values[source]) && after.values[source] !== before.values[source]) {
      for (const key of group) if (!present(after.values[key])) delete values[key];
    }
  }
  // A repair must not replace a recent announcement with an old or undated milestone.
  // The retained announcement still has to pass live quote/date checks before the job can proceed.
  const keptGrowth = recent(before.values.growth_date, now) && !recent(after.values.growth_date, now);
  if (keptGrowth) for (const key of ['growth_source', 'growth_quote', 'growth_date', 'growth_evidence']) {
    if (before.values[key] !== undefined) values[key] = before.values[key]; else delete values[key];
  }
  const required = ['team_source', 'growth_source', 'person_source', 'contact_source', 'feed', 'cta_url'];
  const citations = new Set([...before.sources, ...after.sources]);
  // Preserve only citations actually supplied by a worker, prioritizing the fields being validated.
  const sources = [...new Set([...required.map(key => values[key]).filter((url): url is string => typeof url === 'string' && citations.has(url)), ...citations])].slice(0, 20);
  return { ...next, records: [{ values, sources }], summary: keptGrowth ? previous.summary : next.summary,
    gaps: [...new Set([...previous.gaps, ...next.gaps])].slice(0, 20) };
}
