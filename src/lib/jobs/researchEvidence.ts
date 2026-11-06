import { Schema, model, models, type Model, type InferSchemaType, type Types } from 'mongoose';
import { z } from 'zod';
import { extractJson } from '@/lib/ai/json';
import { isSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { browserNavigate } from '@/lib/ai/tools/browserClient';
import { isBrowserWorkerConfigured } from '@/lib/ai/tools/browseRouter';
import { webFetch } from '@/lib/ai/tools/webFetch';
import { JobRun } from '@/lib/models/Job';

const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  companyId: { type: Schema.Types.ObjectId, required: true },
  skill: { type: String, required: true },
  domain: { type: String, required: true },
  name: String, website: String, source: String,
  checkedAt: Date, pageStatus: String, observedLinks: [String],
  qualificationGap: String, lastTried: Date,
  /** Checked facts: what was found, where, when and how. A model's claim is not a fact until code has seen it. */
  facts: [new Schema({ field: String, value: String, source: String, method: String, checkedAt: Date }, { _id: false })],
  /** Set only when a check proved this lead cannot qualify, unlike a page we could not open or have not checked. */
  ineligibleReason: String, ineligibleAt: Date,
}, { timestamps: true });
schema.index({ organizationId: 1, companyId: 1, skill: 1, domain: 1 }, { unique: true });
type Entry = InferSchemaType<typeof schema>;
export const ResearchEvidence: Model<Entry> = models.ResearchEvidence ?? model('ResearchEvidence', schema);
type Scope = { organizationId: Types.ObjectId; companyId: Types.ObjectId; skill: string };
const url = z.string().max(1500).refine(isSafePublicHttpsUrl);
const lead = z.object({ name: z.string().trim().min(1).max(180), website: url, source: url });
const host = (value: string) => new URL(value).hostname.toLowerCase().replace(/^www\./, '');

export function researchExclusions(inventory: string, owned: string[]) {
  const excluded = new Set(owned.map(domain => domain.toLowerCase().replace(/^www\./, '')));
  const data = extractJson(inventory) as { existingCatalog?: { website_url?: string; login_url?: string }[]; previousCandidates?: { domain: string }[] } | null;
  for (const row of data?.existingCatalog ?? []) {
    for (const address of [row.website_url, row.login_url]) if (address && isSafePublicHttpsUrl(address)) excluded.add(host(address));
  }
  for (const row of data?.previousCandidates ?? []) excluded.add(row.domain);
  return excluded;
}

function allowed(domain: string, exclusions: Set<string>) {
  return ![...exclusions].some(value => domain === value || domain.endsWith('.' + value));
}

const FACT_LINKS: { field: string; pattern: RegExp; ownSite?: boolean }[] = [
  { field: 'bluesky', pattern: /^https:\/\/bsky\.app\/profile\/[\w.-]+\/?$/i },
  { field: 'feed', pattern: /(?:\/(?:feed|rss|atom)(?:\.xml)?\/?(?:[?#].*)?$)|(?:\.(?:rss|atom)(?:[?#].*)?$)/i },
  { field: 'contact', pattern: /\/contact(?:-us)?\/?(?:[?#].*)?$/i, ownSite: true },
  { field: 'about', pattern: /\/(?:about(?:-us)?|team)\/?(?:[?#].*)?$/i, ownSite: true },
  { field: 'affiliate', pattern: /affiliate|partners?(?:hip)?(?:\/|$)/i, ownSite: true },
];

/** What a company's own homepage links to, as checked facts. */
export function homepageFacts(website: string, links: string[], now = new Date(), method = 'Link found on the official homepage') {
  const own = host(website);
  const onOwnSite = (link: string) => { try { return host(link) === own; } catch { return false; } };
  return FACT_LINKS.flatMap(({ field, pattern, ownSite }) => {
    const value = links.find(link => pattern.test(link) && (!ownSite || onOwnSite(link)));
    return value ? [{ field, value, source: website, method, checkedAt: now }] : [];
  });
}

/** Leads with more checked facts and a readable site come first, so paid judgment goes to the most promising. */
export function leadRank(lead: { facts?: unknown[] | null; pageStatus?: string | null; qualificationGap?: string | null }) {
  return (lead.facts?.length ?? 0) * 2 + (lead.pageStatus === 'opened' ? 1 : 0) - (lead.qualificationGap ? 1 : 0);
}

/** Leads with a recorded gap that one more check might settle. */
export function leadsNeedingCheck(scope: Scope) {
  return ResearchEvidence.countDocuments({ ...scope, qualificationGap: { $type: 'string' }, ineligibleAt: null });
}

export async function researchReserve(scope: Scope, excluded: Set<string>) {
  if (scope.skill === 'signature_outreach') {
    const used = await JobRun.distinct('output.records.values.prospect_domain', {
      organizationId: scope.organizationId, companyId: scope.companyId, 'output.records.values.screenshot': { $exists: true },
    });
    for (const domain of used) if (typeof domain === 'string') excluded.add(domain);
  }
  // A company can change in a month, so a finding of ineligible does not last forever.
  return ResearchEvidence.find({ ...scope, domain: { $nin: [...excluded] }, $and: [{ $or: [
      { checkedAt: { $gte: new Date(Date.now() - 30 * 86400000) } },
      { lastTried: { $gte: new Date(Date.now() - 30 * 86400000) } },
      { checkedAt: null, createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } },
    ] }, { $or: [{ ineligibleAt: null }, { ineligibleAt: { $lt: new Date(Date.now() - 30 * 86400000) } }] }],
    $or: [{ lastTried: null }, { lastTried: { $lt: new Date(Date.now() - 86400000) } }],
  }).sort({ pageStatus: -1, lastTried: 1, checkedAt: -1 }).limit(30).select('pageStatus name domain website source checkedAt observedLinks qualificationGap facts -_id').lean()
    .then(rows => rows.filter(row => allowed(row.domain, excluded)).sort((a, b) => leadRank(b) - leadRank(a)).slice(0, 5));
}

export const datasetAssignment = 'Return only JSON {"candidates":[{"name":"company name","website":"exact public company website","source":"exact discovery page URL"}]}. Supply up to ten distinct candidates, fewer if necessary. Omit unknown websites. A listing URL is not a candidate website.';

const MIN_LINKS_FOR_PROOF = 3;

export type OpenedLead = { thin: boolean; links: string[]; rendered: boolean };

/** Opens a lead in the real browser, which sees links drawn by JavaScript. Without it, a plain fetch still gives partial evidence. */
export async function openLead(url: string): Promise<OpenedLead> {
  if (isBrowserWorkerConfigured()) {
    // Accuracy matters more than speed here: a slow site gets the browser's full time and a second try.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const page = await browserNavigate(url);
        return { thin: page.text.trim().length < 200, links: page.links, rendered: true };
      } catch (error) {
        console.warn(`[research] browser attempt ${attempt} could not open ${url}`, error instanceof Error ? error.message : 'unknown');
      }
    }
  }
  const page = await webFetch(url);
  return { thin: page.thin, links: page.links, rendered: false };
}

/** A homepage link a job cannot work without, so a real browser not finding it settles the question. */
const REQUIRED_HOMEPAGE_LINK: Record<string, { field: string; reason: string }> = {
  signature_outreach: { field: 'bluesky', reason: 'No Bluesky profile is linked from the official homepage.' },
};

export async function saveScoutBatch(scope: Scope, report: string, excluded: Set<string>, open: (url: string) => Promise<OpenedLead> = openLead) {
  const raw = extractJson(report) as { candidates?: unknown[] } | null;
  const batch = new Map<string, z.infer<typeof lead>>();
  for (const item of Array.isArray(raw?.candidates) ? raw.candidates.slice(0, 20) : []) {
    const parsed = lead.safeParse(item);
    if (!parsed.success) continue;
    const domain = host(parsed.data.website);
    if (allowed(domain, excluded)) batch.set(domain, parsed.data);
    if (batch.size === 10) break;
  }
  let discovered = 0;
  let opened = 0;
  const receipts: string[] = [];
  for (const [domain, candidate] of batch) {
    const filter = { ...scope, domain };
    const result = await ResearchEvidence.updateOne(filter, { $setOnInsert: { ...filter, ...candidate } }, { upsert: true });
    discovered += result.upsertedCount;
    const fresh = await ResearchEvidence.exists({ ...filter, pageStatus: 'opened', checkedAt: { $gt: new Date(Date.now() - 86400000) } });
    if (fresh) continue;
    const page = await open(candidate.website).catch(() => null);
    const pageStatus = !page ? 'inaccessible' : page.thin ? 'limited' : 'opened';
    const links = (page?.links ?? []).filter(link => /feed|rss|atom|about|team|contact|bsky|affiliate|partner/i.test(link)).slice(0, 10);
    // Only what the page itself showed replaces earlier facts. A page that failed to open says nothing about them.
    const facts = page ? homepageFacts(candidate.website, page.links ?? [], new Date(), page.rendered ? 'Link found on the official homepage in a real browser' : 'Link found in the official homepage HTML') : [];
    const required = REQUIRED_HOMEPAGE_LINK[scope.skill];
    const hasRequired = Boolean(required && facts.some(fact => fact.field === required.field));
    // A challenge or error page can have text but hardly any links, and says nothing about the real site.
    const proven = Boolean(required && page?.rendered && pageStatus === 'opened' && !hasRequired && page.links.length >= MIN_LINKS_FOR_PROOF);
    await ResearchEvidence.updateOne(filter, {
      $set: { pageStatus, checkedAt: new Date(), website: candidate.website, source: candidate.source,
        ...(page ? { observedLinks: links, facts } : {}),
        ...(proven ? { ineligibleReason: required!.reason, ineligibleAt: new Date() } : {}) },
      ...(hasRequired ? { $unset: { ineligibleReason: '', ineligibleAt: '' } } : {}),
    });
    if (pageStatus === 'opened') opened++;
    receipts.push(JSON.stringify({ domain, checked: candidate.website, pageStatus, links, facts: facts.map(fact => fact.field) }));
  }
  return { discovered, opened, receipts };
}

export async function rememberQualificationGap(scope: Scope, values: Record<string, unknown>, sources: string[], gap: string, excluded: Set<string>, ineligible = false) {
  const parsed = lead.safeParse({ name: values.company ?? values.name, website: values.website ?? values.website_url, source: sources[0] });
  if (!parsed.success || !allowed(host(parsed.data.website), excluded)) return;
  const filter = { ...scope, domain: host(parsed.data.website) };
  await ResearchEvidence.updateOne(filter, { $setOnInsert: { ...filter, ...parsed.data },
    $set: { qualificationGap: gap.slice(0, 700), lastTried: new Date(), ...(ineligible ? { ineligibleReason: gap.slice(0, 700), ineligibleAt: new Date() } : {}) } }, { upsert: true });
}
