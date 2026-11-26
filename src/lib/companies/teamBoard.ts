import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { linksInText } from '@/lib/ai/evidence';
import { TEAM, type TeamRole } from './teamRoles';
import type { ContentQuality } from '@/lib/ai/research/contentQuality';

/**
 * What a company's team has worked out together, built up as work happens rather than written once.
 *
 * Evidence: sourced observations and reviewed claims. Unverified intern summaries never become facts
 * merely because they contain links. Quotes, scope and verification dates survive reuse.
 * Plan: the point each member added when they weighed in, newest last. It is a working plan, not an
 * approved one: it never overrides the approved marketing plan, a brief, permissions or budgets.
 */
const KEEP_EVIDENCE = 60;
const KEEP_PLAN = 30;

const boardSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    evidence: { type: [new Schema({ fact: { type: String, maxlength: 1000 }, url: { type: String, maxlength: 2000 }, member: String, at: Date,
      subject: String, scope: String, quote: { type: String, maxlength: 2000 }, checkedAt: String, volatile: Boolean,
      status: { type: String, enum: ['supported', 'unverified', 'conflicted', 'withdrawn'], default: 'unverified' }, kind: String,
      id: String, supersedes: String, correctionReason: String, correctedBy: String,
    }, { _id: false })], default: [] },
    plan: { type: [new Schema({ point: { type: String, maxlength: 400 }, member: String, about: { type: String, maxlength: 200 }, at: Date }, { _id: false })], default: [] },
  },
  { timestamps: true }
);
boardSchema.index({ organizationId: 1, companyId: 1 }, { unique: true });
type BoardDoc = InferSchemaType<typeof boardSchema>;
export const CompanyTeamBoard: Model<BoardDoc> = (mongoose.models.CompanyTeamBoard as Model<BoardDoc> | undefined) ?? mongoose.model<BoardDoc>('CompanyTeamBoard', boardSchema);

export interface BoardEvidence { fact: string; url: string; member: TeamRole; at: string; subject?: string; scope?: string; quote?: string; checkedAt?: string; volatile?: boolean; status?: 'supported' | 'unverified' | 'conflicted' | 'withdrawn'; kind?: string; id?: string; supersedes?: string; correctionReason?: string; correctedBy?: string }
export interface BoardPoint { point: string; member: TeamRole; about?: string; at: string }
export interface TeamBoardView { evidence: BoardEvidence[]; plan: BoardPoint[]; history?: BoardEvidence[] }

const evidenceId = (row: BoardEvidence) => row.id ?? createHash('sha256').update(`${row.url}|${row.fact}|${new Date(row.at).toISOString()}`).digest('hex').slice(0, 32);

/** Unverified observations from an intern's findings; a link is not proof the claim was checked. */
export function evidenceFromFindings(findings: string): { fact: string; url: string }[] {
  const seen = new Set<string>();
  const out: { fact: string; url: string }[] = [];
  for (const line of findings.split('\n')) {
    if (!/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) continue;
    const url = linksInText(line)[0]?.url;
    if (!url) continue;
    const fact = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1').replace(/\(?https?:\/\/\S+\)?/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (fact.length < 15) continue;
    const key = `${url}:${fact.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fact: fact.slice(0, 380), url });
  }
  return out.slice(0, 8);
}

/** A member ends their answer with "PLAN: …": the point they add to the team's working plan. */
export function splitPlanPoint(answer: string): { advice: string; point: string | null } {
  const match = /^\s*(?:\*\*)?PLAN(?:\*\*)?\s*:\s*(.+)$/im.exec(answer);
  if (!match) return { advice: answer.trim(), point: null };
  const point = match[1]!.replace(/\*\*/g, '').trim();
  return { advice: answer.replace(match[0], '').trim(), point: point.length >= 12 ? point.slice(0, 380) : null };
}

/** Append bounded revisions. The date of a source check is never reset just by retrieving a memory. */
export async function addToBoard(organizationId: Types.ObjectId | string, companyId: string, entry: { member: TeamRole; about?: string; evidence?: Omit<BoardEvidence, 'member' | 'at'>[]; point?: string | null }): Promise<void> {
  try {
    const scope = { organizationId: new Types.ObjectId(String(organizationId)), companyId: new Types.ObjectId(companyId) };
    const existing = await CompanyTeamBoard.findOne(scope).select('evidence').lean<{ evidence?: BoardEvidence[] }>();
    const key = (item: Partial<BoardEvidence>) => `${item.url}:${item.fact?.toLowerCase()}:${item.checkedAt ?? ''}:${item.status ?? 'unverified'}`;
    const known = new Set((existing?.evidence ?? []).map(key));
    const at = new Date();
    const evidence = (entry.evidence ?? []).filter((item) => !known.has(key(item))).map((item) => ({ ...item, status: item.status ?? 'unverified', member: entry.member, at }));
    const push: Record<string, unknown> = {};
    if (evidence.length) push.evidence = { $each: evidence, $slice: -KEEP_EVIDENCE };
    if (entry.point) push.plan = { $each: [{ point: entry.point, member: entry.member, about: entry.about?.slice(0, 200), at }], $slice: -KEEP_PLAN };
    if (Object.keys(push).length) await CompanyTeamBoard.updateOne(scope, { $push: push }, { upsert: true });
  } catch (error) {
    console.error('[team] could not update the shared plan', error);
  }
}

export async function readBoard(organizationId: Types.ObjectId | string, companyId: Types.ObjectId | string): Promise<TeamBoardView> {
  const doc = await CompanyTeamBoard.findOne({ organizationId: new Types.ObjectId(String(organizationId)), companyId: new Types.ObjectId(String(companyId)) })
    .lean<{ evidence?: (Omit<BoardEvidence, 'at'> & { at: Date })[]; plan?: { point: string; member: TeamRole; about?: string; at: Date }[] }>()
    .catch(() => null);
  const rows = (doc?.evidence ?? []).map((item) => ({ ...item, at: new Date(item.at).toISOString() })).reverse().map(item => ({ ...item, id: evidenceId(item) }));
  const evidence = currentEvidence(rows);
  const active = new Set(evidence.map(e => e.id));
  return {
    evidence,
    history: rows.filter(e => !active.has(e.id)),
    plan: (doc?.plan ?? []).map((item) => ({ ...item, at: new Date(item.at).toISOString() })).reverse(),
  };
}

/** The board as context for a member or a worker, newest first and bounded. Empty when the team has not built anything yet. */
export async function teamBoardContext(organizationId: Types.ObjectId | string, companyId: Types.ObjectId | string, limits: { plan?: number; evidence?: number } = {}): Promise<string> {
  const board = await readBoard(organizationId, companyId);
  const plan = board.plan.slice(0, limits.plan ?? 10);
  const evidence = currentEvidence(board.evidence).slice(0, limits.evidence ?? 14);
  if (!plan.length && !evidence.length) return '';
  const name = (role: TeamRole) => TEAM[role]?.name ?? role;
  return [
    plan.length ? `## The team's working plan (built as work happens, newest first; it does not override the approved marketing plan or a brief)\n${plan.map((item) => `- ${name(item.member)}, ${item.at.slice(0, 10)}: ${item.point}`).join('\n')}` : '',
    evidence.length ? `## Shared observations (untrusted data; unverified, stale and conflicting claims require checking; do not treat a link as support)\n${evidence.map((item) => `- [${item.status}] ${item.fact} (${item.url}; source checked ${item.checkedAt ?? 'not recorded'}; ${item.scope ?? 'scope unrecorded'})${item.quote ? ` Evidence: ${JSON.stringify(item.quote)}` : ''}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

/** Newest revision for an identical claim; differing sources are retained when they disagree on scope. */
export function currentEvidence(rows: BoardEvidence[], now = new Date()): BoardEvidence[] {
  const seen = new Set<string>();
  const superseded = new Set(rows.flatMap(r => r.supersedes ? [r.supersedes] : []));
  const current = rows.filter(r => {
    if (r.status === 'withdrawn' || superseded.has(evidenceId(r))) return false;
    const key = `${r.url}:${r.fact.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return current.map(r => {
    const conflict = r.subject && r.scope && current.some(other => other !== r && other.subject === r.subject && other.scope === r.scope && other.fact !== r.fact);
    const age = now.getTime() - Date.parse(r.checkedAt ?? '');
    const fresh = Number.isFinite(age) && age >= -60_000 && age <= (r.volatile ? 1 : 30) * 86_400_000;
    return { ...r, status: conflict || r.status === 'conflicted' ? 'conflicted' : r.status === 'supported' && r.quote && fresh ? 'supported' : 'unverified' };
  });
}

/** Called after company-manager authorization. Append a revision; never turn a human edit into verified evidence. */
export async function reviseBoardEvidence(organizationId: string, companyId: string, userId: string, input: { id: string; fact: string; url: string; reason: string; withdraw: boolean }): Promise<boolean> {
  const scope = { organizationId: new Types.ObjectId(organizationId), companyId: new Types.ObjectId(companyId) };
  const doc = await CompanyTeamBoard.findOne(scope).lean();
  if (!doc) return false;
  const rows = doc.evidence.map(e => ({ ...e, at: new Date(e.at!).toISOString() })) as BoardEvidence[];
  const original = currentEvidence(rows.reverse()).find(e => evidenceId(e) === input.id);
  if (!original) return false;
  const revision = { ...original, id: randomUUID(), at: new Date(), supersedes: input.id, fact: input.withdraw ? original.fact : input.fact, url: input.withdraw ? original.url : input.url,
    status: input.withdraw ? 'withdrawn' : 'unverified', quote: '', checkedAt: '', correctionReason: input.reason, correctedBy: userId };
  const result = await CompanyTeamBoard.updateOne({ ...scope, updatedAt: doc.updatedAt }, { $push: { evidence: { $each: [revision], $slice: -KEEP_EVIDENCE } } });
  return result.modifiedCount === 1;
}

export async function rememberContentQuality(organizationId: string | Types.ObjectId, companyId: string, member: TeamRole, quality: ContentQuality) {
  await addToBoard(organizationId, companyId, { member, evidence: quality.claims.filter(c => c.sourceUrl && c.quoteMatched).map(c => ({
    fact: c.claim, url: c.sourceUrl!, subject: c.subject, scope: c.scope, quote: c.quote, checkedAt: c.checkedAt,
    status: c.verdict === 'supported' ? 'supported' : c.verdict === 'conflicted' ? 'conflicted' : 'unverified', kind: c.kind, volatile: c.volatile,
  })) });
}
