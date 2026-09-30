import 'server-only';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { browserNavigate } from '@/lib/ai/tools/browserClient';
import { webFetch } from '@/lib/ai/tools/webFetch';
import { isSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { Job } from '@/lib/models/Job';
import { LinkOpportunity, LINK_OPPORTUNITY_STATUSES, type LinkOpportunityStatus } from '@/lib/models/LinkOpportunity';
import type { JobRunOutput } from './schema';

const VERIFY_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;

export interface LinkOpportunityView {
  id: string;
  runId: string;
  status: LinkOpportunityStatus;
  opportunityUrl: string;
  targetUrl: string | null;
  liveLinkUrl: string | null;
  values: Record<string, unknown>;
  sources: string[];
  note: string | null;
  submittedAt: string | null;
  lastVerifiedAt: string | null;
  nextVerificationAt: string | null;
  verificationMessage: string | null;
  updatedAt: string;
}

type OpportunityLean = {
  _id: Types.ObjectId;
  runId: Types.ObjectId;
  status: LinkOpportunityStatus;
  opportunityUrl: string;
  targetUrl?: string;
  liveLinkUrl?: string;
  values: Record<string, unknown>;
  sources?: string[];
  note?: string;
  submittedAt?: Date;
  lastVerifiedAt?: Date;
  nextVerificationAt?: Date;
  verificationMessage?: string;
  updatedAt: Date;
};

function view(row: OpportunityLean): LinkOpportunityView {
  return {
    id: String(row._id),
    runId: String(row.runId),
    status: row.status,
    opportunityUrl: row.opportunityUrl,
    targetUrl: row.targetUrl ?? null,
    liveLinkUrl: row.liveLinkUrl ?? null,
    values: row.values,
    sources: row.sources ?? [],
    note: row.note ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    nextVerificationAt: row.nextVerificationAt?.toISOString() ?? null,
    verificationMessage: row.verificationMessage ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

function fingerprint(opportunityUrl: string, targetUrl: string | null): string {
  return createHash('sha256').update(`${opportunityUrl}\n${targetUrl ?? ''}`).digest('hex');
}

export async function syncLinkOpportunities(input: {
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  jobId: Types.ObjectId;
  runId: Types.ObjectId;
  output: JobRunOutput;
  approved?: boolean;
}): Promise<void> {
  for (const record of input.output.records) {
    const opportunityUrl = normalizeUrl(record.values.opportunity_url);
    if (!opportunityUrl) continue;
    const targetUrl = normalizeUrl(record.values.target_url);
    const status: LinkOpportunityStatus = input.approved ? 'approved' : 'recommended';
    await LinkOpportunity.updateOne(
      { jobId: input.jobId, fingerprint: fingerprint(opportunityUrl, targetUrl) },
      {
        $setOnInsert: {
          organizationId: input.organizationId,
          companyId: input.companyId,
          jobId: input.jobId,
          runId: input.runId,
          fingerprint: fingerprint(opportunityUrl, targetUrl),
          opportunityUrl,
          ...(targetUrl ? { targetUrl } : {}),
          status,
          values: record.values,
          sources: record.sources,
          history: [{ at: new Date(), status, note: input.approved ? 'Automatically approved after a clean automatic run.' : 'Recommended by Nucleas.' }],
        },
      },
      { upsert: true }
    );
  }
}

export async function listLinkOpportunities(jobId: Types.ObjectId): Promise<LinkOpportunityView[]> {
  const rows = await LinkOpportunity.find({ jobId }).sort({ updatedAt: -1 }).limit(200).lean<OpportunityLean[]>();
  return rows.map(view);
}

/** Compact strategy memory for the next recommendation run. */
export async function linkOpportunityMemory(jobId: Types.ObjectId, limit = 80): Promise<string> {
  const rows = await LinkOpportunity.find({ jobId })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('status opportunityUrl targetUrl values note verificationMessage')
    .lean<Array<{ status: LinkOpportunityStatus; opportunityUrl: string; targetUrl?: string; values?: Record<string, unknown>; note?: string; verificationMessage?: string }>>();
  return rows.map((row) => {
    const type = typeof row.values?.opportunity_type === 'string' ? row.values.opportunity_type : 'opportunity';
    const reason = typeof row.values?.strategic_reason === 'string' ? row.values.strategic_reason.slice(0, 180) : '';
    return `- ${row.status}: ${type} ${row.opportunityUrl}${row.targetUrl ? ` -> ${row.targetUrl}` : ''}${reason ? ` | strategy: ${reason}` : ''}${row.note ? ` | feedback: ${row.note}` : ''}${row.verificationMessage ? ` | verification: ${row.verificationMessage}` : ''}`;
  }).join('\n');
}

const TRANSITIONS: Record<LinkOpportunityStatus, LinkOpportunityStatus[]> = {
  recommended: ['saved', 'approved', 'rejected'],
  saved: ['approved', 'rejected'],
  approved: ['saved', 'rejected', 'submitted'],
  rejected: ['saved', 'approved'],
  submitted: ['live', 'submission_rejected'],
  live: ['removed'],
  submission_rejected: ['saved', 'submitted', 'expired'],
  removed: ['live', 'expired'],
  expired: ['saved'],
};

export async function updateLinkOpportunity(
  viewer: CompanyViewer,
  jobId: string,
  opportunityId: string,
  input: { status: unknown; note?: unknown; liveLinkUrl?: unknown }
): Promise<{ ok: true } | { ok: false; status: 400 | 403 | 404 | 409; error: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can update opportunities.' };
  if (!Types.ObjectId.isValid(jobId) || !Types.ObjectId.isValid(opportunityId)) return { ok: false, status: 404, error: 'Opportunity not found.' };
  if (!LINK_OPPORTUNITY_STATUSES.includes(input.status as LinkOpportunityStatus)) return { ok: false, status: 400, error: 'Invalid opportunity status.' };
  const row = await LinkOpportunity.findOne({ _id: new Types.ObjectId(opportunityId), jobId: new Types.ObjectId(jobId), organizationId: viewer.organizationId });
  if (!row) return { ok: false, status: 404, error: 'Opportunity not found.' };
  const status = input.status as LinkOpportunityStatus;
  if (!TRANSITIONS[row.status as LinkOpportunityStatus].includes(status)) return { ok: false, status: 409, error: `A ${row.status.replace('_', ' ')} opportunity cannot move directly to ${status.replace('_', ' ')}.` };
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 1000) : undefined;
  const liveLinkUrl = normalizeUrl(input.liveLinkUrl);
  if (input.liveLinkUrl && (!liveLinkUrl || !isSafePublicHttpsUrl(liveLinkUrl))) {
    return { ok: false, status: 400, error: 'The submitted page must be a safe public HTTPS URL.' };
  }
  if ((status === 'submitted' || status === 'live') && !liveLinkUrl && !row.liveLinkUrl) {
    return { ok: false, status: 400, error: 'Add the submitted or live page URL so Nucleas can verify it.' };
  }
  const now = new Date();
  row.status = status;
  if (note) row.note = note;
  if (liveLinkUrl) row.liveLinkUrl = liveLinkUrl;
  if (status === 'submitted') row.submittedAt = now;
  if (status === 'submitted' || status === 'live') row.nextVerificationAt = now;
  else row.nextVerificationAt = undefined;
  row.history.push({ at: now, status, userId: new Types.ObjectId(viewer.userId), ...(note ? { note } : {}) });
  await row.save();
  return { ok: true };
}

function targetMatches(links: string[], targetUrl: string): boolean {
  const target = normalizeUrl(targetUrl);
  if (!target) return false;
  return links.some((link) => normalizeUrl(link) === target);
}

export async function verifyLinkOpportunity(opportunityId: string, now = new Date()): Promise<'found' | 'not_found' | 'unavailable'> {
  if (!Types.ObjectId.isValid(opportunityId)) return 'unavailable';
  const row = await LinkOpportunity.findById(opportunityId);
  if (!row?.liveLinkUrl || !row.targetUrl || !['submitted', 'live', 'removed'].includes(row.status)) return 'unavailable';
  let links: string[] = [];
  let unavailable = false;
  try {
    const page = await browserNavigate(row.liveLinkUrl);
    links = page.links;
  } catch {
    try {
      const page = await webFetch(row.liveLinkUrl);
      links = page.links;
    } catch {
      unavailable = true;
    }
  }
  const found = targetMatches(links, row.targetUrl);
  const verification = unavailable ? 'unavailable' : found ? 'found' : 'not_found';
  const previous = row.status as LinkOpportunityStatus;
  const next: LinkOpportunityStatus = found ? 'live' : previous === 'live' ? 'removed' : previous;
  row.status = next;
  row.lastVerifiedAt = now;
  row.nextVerificationAt = new Date(now.getTime() + VERIFY_AGAIN_MS);
  row.verificationMessage = unavailable ? 'The page could not be checked.' : found ? 'The target link was found on the submitted page.' : 'The target link was not found on the submitted page.';
  row.history.push({ at: now, status: next, verification, note: row.verificationMessage });
  await row.save();
  return verification;
}

export async function verifyDueLinkOpportunities(now = new Date(), limit = 10): Promise<number> {
  const rows = await LinkOpportunity.find({ status: { $in: ['submitted', 'live', 'removed'] }, nextVerificationAt: { $lte: now } })
    .sort({ nextVerificationAt: 1 })
    .limit(Math.max(1, Math.min(limit, 25)))
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();
  // Keep browser usage deliberately small on the shared VPS.
  for (let i = 0; i < rows.length; i += 2) {
    await Promise.all(rows.slice(i, i + 2).map((row) => verifyLinkOpportunity(String(row._id), now)));
  }
  return rows.length;
}

export async function bulkDecideRunOpportunities(runId: Types.ObjectId, decision: 'accept' | 'reject', viewer: CompanyViewer, note?: string): Promise<void> {
  const from = decision === 'accept' ? ['recommended', 'saved'] : ['recommended', 'saved', 'approved'];
  const status: LinkOpportunityStatus = decision === 'accept' ? 'approved' : 'rejected';
  await LinkOpportunity.updateMany(
    { runId, status: { $in: from } },
    {
      $set: { status, ...(note ? { note: note.slice(0, 1000) } : {}) },
      $push: { history: { at: new Date(), status, userId: new Types.ObjectId(viewer.userId), ...(note ? { note: note.slice(0, 1000) } : {}) } },
    }
  );
}

export async function viewerOwnsOpportunity(viewer: CompanyViewer, jobId: string, opportunityId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(jobId) || !Types.ObjectId.isValid(opportunityId)) return false;
  const ownsJob = await Job.exists({ _id: new Types.ObjectId(jobId), organizationId: viewer.organizationId });
  if (!ownsJob) return false;
  return Boolean(await LinkOpportunity.exists({ _id: new Types.ObjectId(opportunityId), jobId: new Types.ObjectId(jobId), organizationId: viewer.organizationId }));
}
