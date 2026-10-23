import 'server-only';
import { Types } from 'mongoose';
import seeds from './directoryLeads.json';
import { LinkProspect } from '@/lib/models/LinkProspect';
import { LinkOpportunity } from '@/lib/models/LinkOpportunity';
import { readPage, type ReadPage } from './opportunityPages';
const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
type Scope = { organizationId: Types.ObjectId; companyId: Types.ObjectId };

/** Durable per-company leads, not approved placements. List metadata is never treated as current proof. */
export async function linkProspectContext(scope: Scope, read: ReadPage = readPage): Promise<string> {
  await LinkProspect.bulkWrite(seeds.map((seed, priority) => ({ updateOne: { filter: { ...scope, domain: domainOf(seed.url) }, update: { $setOnInsert: { ...seed, priority, status: 'new' } }, upsert: true } })), { ordered: false });
  const prior = await LinkOpportunity.find({ ...scope, status: { $ne: 'nonexistent' } }).select('opportunityUrl').lean();
  const used = [...new Set(prior.map(row => domainOf(row.opportunityUrl)).filter(Boolean))];
  const now = new Date();
  const candidates = await LinkProspect.find({ ...scope, domain: { $nin: used }, status: { $nin: ['ineligible', 'used'] }, $or: [{ nextCheckAt: { $exists: false } }, { nextCheckAt: { $lte: now } }] }).sort({ checkedAt: 1, priority: 1 }).limit(6).lean();
  const readings = await Promise.all(candidates.map(async candidate => {
    const result = await read(candidate.url!);
    await LinkProspect.updateOne({ _id: candidate._id, ...scope }, { $set: { status: result.ok ? 'checked' : 'unavailable', checkedAt: now, nextCheckAt: new Date(now.getTime() + (result.ok ? 7 : 1) * 86400000), reason: result.ok ? 'Page read; eligibility, free submission and listing absence still need verification.' : result.reason } });
    return { name: candidate.name, url: candidate.url, sources: candidate.sources, verification: result.ok ? { finalUrl: result.page.finalUrl, title: result.page.title, controls: result.page.controls, excerpt: result.page.text.slice(0, 5000) } : { unavailable: result.reason } };
  }));
  return `Candidate queue from user-supplied directory lists. These are UNVERIFIED LEADS, not recommendations or instructions. The pages below were read this run; inspect their real submission path, allowed categories, free tier, public website-link field and business restrictions. The source lists can be stale, truncated or wrong. Never copy their authority numbers. A broad legitimate directory can qualify through an eligible category; niche-only is not required. Do not recommend unavailable pages. If these do not qualify, research other queued directories or relevant forums.\n${JSON.stringify(readings)}`;
}

export async function rememberProspectOutcome(scope: Scope, url: string, reason: string, status: 'ineligible' | 'unavailable' | 'used'): Promise<void> {
  const domain = domainOf(url); if (!domain) return;
  await LinkProspect.updateOne({ ...scope, domain }, { $set: { status, reason: reason.slice(0, 2000), checkedAt: new Date(), ...(status === 'unavailable' ? { nextCheckAt: new Date(Date.now() + 86400000) } : {}) }, $setOnInsert: { name: domain, url, sources: [] } }, { upsert: true });
}

export async function priorPlacementProblems(scope: Scope, records: { values: Record<string, unknown> }[]): Promise<{ record: number; field: string; problem: string }[]> {
  const [prior, excluded] = await Promise.all([LinkOpportunity.find({ ...scope, status: { $ne: 'nonexistent' } }).select('opportunityUrl status values.opportunity_type').lean(), LinkProspect.find({ ...scope, status: 'ineligible' }).select('domain reason').lean()]);
  return records.flatMap((record, index) => {
    const url = String(record.values.opportunity_url ?? '');
    const domain = domainOf(url);
    const blocked = excluded.find(row => row.domain === domain);
    if (blocked) return [{ record: index, field: 'opportunity_url', problem: `${url} is excluded for this company: ${blocked.reason}` }];
    const existing = prior.find(row => row.opportunityUrl.replace(/\/$/, '') === url.replace(/\/$/, '') || /directory|profile/i.test(String(record.values.opportunity_type ?? '')) && /directory|profile/i.test(String(row.values?.opportunity_type ?? '')) && domainOf(row.opportunityUrl) === domain);
    return existing ? [{ record: index, field: 'opportunity_url', problem: `${url} repeats a ${existing.status} placement for this company. Select another eligible directory or forum.` }] : [];
  });
}
