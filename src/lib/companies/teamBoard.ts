import 'server-only';
import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { linksInText } from '@/lib/ai/evidence';
import { TEAM, type TeamRole } from './teamRoles';

/**
 * What a company's team has worked out together, built up as work happens rather than written once.
 *
 * Evidence: facts an intern read on a real page, each kept with its source and date. Only sourced facts
 * get in, so every member reasons from the same checked ground instead of each one's own memory.
 * Plan: the point each member added when they weighed in, newest last. It is a working plan, not an
 * approved one: it never overrides the approved marketing plan, a brief, permissions or budgets.
 */
const KEEP_EVIDENCE = 60;
const KEEP_PLAN = 30;

const boardSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    evidence: { type: [new Schema({ fact: { type: String, maxlength: 400 }, url: { type: String, maxlength: 2000 }, member: String, at: Date }, { _id: false })], default: [] },
    plan: { type: [new Schema({ point: { type: String, maxlength: 400 }, member: String, about: { type: String, maxlength: 200 }, at: Date }, { _id: false })], default: [] },
  },
  { timestamps: true }
);
boardSchema.index({ organizationId: 1, companyId: 1 }, { unique: true });
type BoardDoc = InferSchemaType<typeof boardSchema>;
export const CompanyTeamBoard: Model<BoardDoc> = (mongoose.models.CompanyTeamBoard as Model<BoardDoc> | undefined) ?? mongoose.model<BoardDoc>('CompanyTeamBoard', boardSchema);

export interface BoardEvidence { fact: string; url: string; member: TeamRole; at: string }
export interface BoardPoint { point: string; member: TeamRole; about?: string; at: string }
export interface TeamBoardView { evidence: BoardEvidence[]; plan: BoardPoint[] }

/** Sourced facts from an intern's findings: one per bullet that links to the page it came from. */
export function evidenceFromFindings(findings: string): { fact: string; url: string }[] {
  const seen = new Set<string>();
  const out: { fact: string; url: string }[] = [];
  for (const line of findings.split('\n')) {
    if (!/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) continue;
    const url = linksInText(line)[0]?.url;
    if (!url || seen.has(url)) continue;
    const fact = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1').replace(/\(?https?:\/\/\S+\)?/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (fact.length < 15) continue;
    seen.add(url);
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

/** Adds to the board. Evidence already there (same page) is left alone; old entries roll off. Best effort: never fails the work. */
export async function addToBoard(organizationId: Types.ObjectId | string, companyId: string, entry: { member: TeamRole; about?: string; evidence?: { fact: string; url: string }[]; point?: string | null }): Promise<void> {
  try {
    const scope = { organizationId: new Types.ObjectId(String(organizationId)), companyId: new Types.ObjectId(companyId) };
    const existing = await CompanyTeamBoard.findOne(scope).select('evidence.url').lean<{ evidence?: { url?: string }[] }>();
    const known = new Set((existing?.evidence ?? []).map((item) => item.url));
    const at = new Date();
    const evidence = (entry.evidence ?? []).filter((item) => !known.has(item.url)).map((item) => ({ ...item, member: entry.member, at }));
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
    .lean<{ evidence?: { fact: string; url: string; member: TeamRole; at: Date }[]; plan?: { point: string; member: TeamRole; about?: string; at: Date }[] }>()
    .catch(() => null);
  return {
    evidence: (doc?.evidence ?? []).map((item) => ({ ...item, at: new Date(item.at).toISOString() })).reverse(),
    plan: (doc?.plan ?? []).map((item) => ({ ...item, at: new Date(item.at).toISOString() })).reverse(),
  };
}

/** The board as context for a member or a worker, newest first and bounded. Empty when the team has not built anything yet. */
export async function teamBoardContext(organizationId: Types.ObjectId | string, companyId: Types.ObjectId | string, limits: { plan?: number; evidence?: number } = {}): Promise<string> {
  const board = await readBoard(organizationId, companyId);
  const plan = board.plan.slice(0, limits.plan ?? 10);
  const evidence = board.evidence.slice(0, limits.evidence ?? 14);
  if (!plan.length && !evidence.length) return '';
  const name = (role: TeamRole) => TEAM[role]?.name ?? role;
  return [
    plan.length ? `## The team's working plan (built as work happens, newest first; it does not override the approved marketing plan or a brief)\n${plan.map((item) => `- ${name(item.member)}, ${item.at.slice(0, 10)}: ${item.point}`).join('\n')}` : '',
    evidence.length ? `## Shared evidence the team relies on (each was read on the page given; check the date before treating it as current)\n${evidence.map((item) => `- ${item.fact} (${item.url}, read ${item.at.slice(0, 10)})`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
