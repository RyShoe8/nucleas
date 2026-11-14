import { Types } from 'mongoose';
import { AiBudget, AiRun, AiSearchApiUsage } from '@/lib/models/AiControl';
import Project from '@/lib/models/Project';
import User from '@/lib/models/User';
import Client from '@/lib/models/Client';
import { freeChatLedgerProjectId } from '@/lib/ide/freeChat';
import { assistantLedgerProjectId } from '@/lib/ai/company/assistantLedger';
import { estimateSearchApiMicros } from '@/lib/ai/pricing/searchApiRates';
import { Job, JobRun } from '@/lib/models/Job';
import { CompanyAssistantTurn } from '@/lib/models/CompanyAssistantTurn';

/**
 * Organization-wide AI spend for one UTC month. Costs are the settled amounts recorded on each AI
 * run (micro-dollars). Runs whose provider never reported usage are counted separately as unknown,
 * never as $0. The budget ledger (settled + reserved + limit) is shown alongside for reconciliation.
 */

export interface SpendRow {
  key: string;
  label: string;
  detail?: string;
  costMicros: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  /** Finished runs whose provider never reported tokens. Unknown, not zero. */
  unknownTokenRuns: number;
}

export interface OrgAiSpend {
  period: string;
  budget: { limitMicros: number | null; spentMicros: number; reservedMicros: number };
  totals: { costMicros: number; runs: number; unknownCostRuns: number; inputTokens: number; outputTokens: number };
  byDay: { date: string; costMicros: number; runs: number }[];
  bySource: SpendRow[];
  /**
   * By job, from the cost each job run already records (the job card's "Spent this month"), plus Ask from
   * the cost on each answer. A view of the same spending, not added to the totals.
   */
  byJob: { key: string; label: string; detail?: string; costMicros: number; runs: number }[];
  byModel: SpendRow[];
  byUser: SpendRow[];
  search: { braveQueries: number; googleQueries: number; estimatedMicros: number };
}

export function monthBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

type Group = { _id: unknown; costMicros: number; runs: number; inputTokens: number; outputTokens: number; unknownTokenRuns: number; cacheReadTokens?: number };

export async function getOrgAiSpend(organizationId: string, period: string, now = new Date()): Promise<OrgAiSpend> {
  const { start, end } = monthBounds(period);
  const match = { organizationId, createdAt: { $gte: start, $lt: end } };
  const costExpr = { $ifNull: ['$costMicros', 0] };

  const [totalsRow] = await AiRun.aggregate<{
    costMicros: number;
    runs: number;
    unknownCostRuns: number;
    inputTokens: number;
    outputTokens: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: null,
        costMicros: { $sum: costExpr },
        runs: { $sum: 1 },
        unknownCostRuns: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $eq: [{ $type: '$costMicros' }, 'missing'] }] }, 1, 0] } },
        inputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
        outputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } },
      },
    },
    { $project: { _id: 0 } },
  ]);

  const group = (field: string) =>
    AiRun.aggregate<Group>([
      { $match: match },
      {
        $group: {
          _id: field,
          costMicros: { $sum: costExpr },
          runs: { $sum: 1 },
          inputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
          outputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } },
          unknownTokenRuns: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $eq: [{ $type: '$inputTokens' }, 'missing'] }, { $eq: [{ $type: '$outputTokens' }, 'missing'] }] }, 1, 0] } },
          cacheReadTokens: { $sum: { $ifNull: ['$cacheReadTokens', 0] } },
        },
      },
      { $sort: { costMicros: -1, runs: -1 } },
    ]);

  const [days, sources, models, users, byJob] = await Promise.all([
    AiRun.aggregate<Pick<Group, '_id' | 'costMicros' | 'runs'>>([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, costMicros: { $sum: costExpr }, runs: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    group('$projectId'),
    group('$model'),
    group('$createdByUserId'),
    spendByJob(organizationId, start, end),
  ]);

  // Label sources: Ask Nucleas and Free Chat ledgers, otherwise the project (and its company).
  const freeChat = String(freeChatLedgerProjectId(organizationId));
  const assistant = String(assistantLedgerProjectId(organizationId));
  const projectIds = sources.map((s) => String(s._id)).filter((id) => id !== freeChat && id !== assistant && Types.ObjectId.isValid(id));
  const projects = await Project.find({ _id: { $in: projectIds } })
    .select('name clientId')
    .lean<{ _id: Types.ObjectId; name: string; clientId?: Types.ObjectId }[]>();
  const clients = await Client.find({ _id: { $in: projects.map((p) => p.clientId).filter(Boolean) } })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const clientName = new Map(clients.map((c) => [String(c._id), c.name]));
  const projectById = new Map(projects.map((p) => [String(p._id), p]));

  const usage = (g: Group) => ({ costMicros: g.costMicros, runs: g.runs, inputTokens: g.inputTokens, outputTokens: g.outputTokens, unknownTokenRuns: g.unknownTokenRuns });
  const bySource: SpendRow[] = sources.map((s) => {
    const id = String(s._id);
    if (id === assistant) return { key: id, label: 'Nucleas', ...usage(s) };
    if (id === freeChat) return { key: id, label: 'Free Chat', detail: 'IDE', ...usage(s) };
    const p = projectById.get(id);
    const company = p?.clientId ? clientName.get(String(p.clientId)) : undefined;
    return {
      key: id,
      label: p?.name ?? 'Deleted project',
      detail: company && company !== p?.name ? `${company} · IDE / planning` : 'IDE / planning',
      ...usage(s),
    };
  });

  const userRows = await User.find({ _id: { $in: users.map((u) => u._id).filter((id) => Types.ObjectId.isValid(String(id))) } })
    .select('name email')
    .lean<{ _id: Types.ObjectId; name?: string; email?: string }[]>();
  const userName = new Map(userRows.map((u) => [String(u._id), u.name || u.email || 'Unknown']));

  const budget = await AiBudget.findOne({ organizationId, scopeKey: 'organization', period })
    .select('limitMicros spentMicros reservedMicros')
    .lean<{ limitMicros?: number; spentMicros?: number; reservedMicros?: number }>();

  const searchUsage = await AiSearchApiUsage.findOne({ organizationId, periodMonth: period })
    .select('braveQueries googleCseWebQueries googleCseImageQueries')
    .lean<{ braveQueries?: number; googleCseWebQueries?: number; googleCseImageQueries?: number }>();
  const braveQueries = searchUsage?.braveQueries ?? 0;
  const googleQueries = (searchUsage?.googleCseWebQueries ?? 0) + (searchUsage?.googleCseImageQueries ?? 0);
  const isCurrent = now >= start && now < end;
  const dayOfMonth = isCurrent ? now.getUTCDate() : new Date(end.getTime() - 86_400_000).getUTCDate();

  return {
    period,
    budget: { limitMicros: budget?.limitMicros ?? null, spentMicros: budget?.spentMicros ?? 0, reservedMicros: budget?.reservedMicros ?? 0 },
    totals: totalsRow ?? { costMicros: 0, runs: 0, unknownCostRuns: 0, inputTokens: 0, outputTokens: 0 },
    byDay: days.map((d) => ({ date: String(d._id), costMicros: d.costMicros, runs: d.runs })),
    bySource,
    byJob,
    byModel: models.map((m) => ({ key: String(m._id ?? 'unknown'), label: m._id ? String(m._id) : 'Unknown model', ...(m.cacheReadTokens ? { detail: `${Math.round((m.cacheReadTokens / Math.max(1, m.inputTokens)) * 100)}% of input read from cache` } : {}), ...usage(m) })),
    byUser: users.map((u) => ({ key: String(u._id), label: userName.get(String(u._id)) ?? 'Unknown', ...usage(u) })),
    search: { braveQueries, googleQueries, estimatedMicros: estimateSearchApiMicros({ braveQueries, googleCseQueries: googleQueries, dayOfMonth }) },
  };
}

/** Each job's spend this month from its runs' recorded costs, and Ask's from its answers, largest first. */
async function spendByJob(organizationId: string, start: Date, end: Date): Promise<OrgAiSpend['byJob']> {
  if (!Types.ObjectId.isValid(organizationId)) return [];
  const org = new Types.ObjectId(organizationId);
  const [runs, ask] = await Promise.all([
    JobRun.aggregate<{ _id: Types.ObjectId; costMicros: number; runs: number }>([
      { $match: { organizationId: org, createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: '$jobId', costMicros: { $sum: { $ifNull: ['$costMicros', 0] } }, runs: { $sum: 1 } } },
    ]),
    CompanyAssistantTurn.aggregate<{ costMicros: number; runs: number }>([
      { $match: { organizationId: org, role: 'assistant', createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: null, costMicros: { $sum: { $ifNull: ['$costMicros', 0] } }, runs: { $sum: 1 } } },
    ]),
  ]);
  const jobs = await Job.find({ _id: { $in: runs.map((row) => row._id) } }).select('design request').lean<{ _id: Types.ObjectId; design?: { name?: string; skill?: string }; request?: string }[]>();
  const byId = new Map(jobs.map((job) => [String(job._id), job]));
  const rows: OrgAiSpend['byJob'] = runs.map((row) => {
    const job = byId.get(String(row._id));
    const name = job?.design?.name || job?.request?.slice(0, 60) || 'Deleted job';
    return { key: String(row._id), label: name, ...(job?.design?.skill ? { detail: job.design.skill.replaceAll('_', ' ') } : {}), costMicros: row.costMicros, runs: row.runs };
  });
  if (ask[0]?.runs) rows.push({ key: 'ask', label: 'Ask', detail: 'answers in Ask Nucleas', costMicros: ask[0].costMicros, runs: ask[0].runs });
  return rows.filter((row) => row.costMicros > 0).sort((a, b) => b.costMicros - a.costMicros);
}
