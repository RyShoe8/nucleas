import { Types } from 'mongoose';
import Project from '@/lib/models/Project';
import ContentItem from '@/lib/models/ContentItem';
import { CapabilityApproval } from '@/lib/models/Capability';
import { getCompanyProfile, listCompanyProfiles, type CompanyProfile, type CompanyViewer } from '@/lib/companies/companyProfile';
import { listCompanyConnections } from '@/lib/integrations/connections';
import { getCompanyMetrics, getTodayOverview } from '@/lib/metrics/query';
import { listInvocations } from '@/lib/capabilities/runtime';

/**
 * Assembles what Nucleas knows about one company for the AI, within a character budget.
 * Scope comes from authorization (the viewer + companyId), never from the prompt. Everything here
 * is data for the model to reason over, not instructions. Sensitive metrics are excluded.
 */

export interface ContextSection {
  key: string;
  title: string;
  body: string;
}

export interface CompanyContext {
  companyId: string;
  companyName: string;
  /** Hub project used for AI run and budget accounting. */
  hubProjectId: string | null;
  sections: ContextSection[];
  sources: string[];
  omitted: string[];
}

const DEFAULT_BUDGET = 9000;

function money(minor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(minor / 100);
}

function fmt(unit: string, v: number | null): string {
  if (v === null) return 'n/a';
  return unit === 'money' ? money(v) : new Intl.NumberFormat('en-US').format(Math.round(v));
}

export async function resolveCompanyContext(
  viewer: CompanyViewer,
  companyId: string,
  options: { budgetChars?: number; now?: Date } = {}
): Promise<CompanyContext | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  const now = options.now ?? new Date();
  const budget = options.budgetChars ?? DEFAULT_BUDGET;
  const cid = new Types.ObjectId(companyId);
  const sections: ContextSection[] = [];
  const sources: string[] = [];

  // Company
  sections.push({
    key: 'company',
    title: 'Company',
    body: [
      `Name: ${profile.name}`,
      `Relationship: ${profile.relationship === 'client' ? 'client (we work for them)' : profile.relationship === 'internal' ? 'our operating company' : 'our own business'}`,
      `Production domain: ${profile.domain ?? 'none yet'}`,
      profile.devUrl ? `Dev URL: ${profile.devUrl}` : null,
      profile.description ? `Description: ${profile.description.slice(0, 400)}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  sources.push('company profile');

  // Integrations
  const connections = (await listCompanyConnections(viewer, companyId)) ?? [];
  if (connections.length) {
    const lines = connections.map(
      (c) =>
        `- ${c.providerName} (${c.domain}): ${c.status}${c.planLimited ? ', plan-limited' : ''}${c.accountLabel ? `, ${c.accountLabel}` : ''}${c.lastError ? ` — ${c.lastError}` : ''}`
    );
    sections.push({ key: 'integrations', title: 'Connected systems', body: lines.join('\n') });
    sources.push('integrations');
  }

  // Metrics
  const metrics = await getCompanyMetrics(viewer, companyId, { now });
  if (metrics && metrics.metrics.length) {
    const lines = metrics.metrics.map((m) => {
      const change = m.change === null ? '' : `, ${m.change >= 0 ? '+' : ''}${Math.round(m.change * 100)}% vs prior`;
      return m.kind === 'daily'
        ? `- ${m.label}: ${fmt(m.unit, m.current)} last 7 days (prior 7: ${fmt(m.unit, m.previous)}${change})${m.stage ? ` [stage: ${m.stage}]` : ''}`
        : `- ${m.label}: ${fmt(m.unit, m.current)} now (week ago: ${fmt(m.unit, m.previous)}${change})`;
    });
    if (metrics.changes.length) lines.push('', 'Notable changes:', ...metrics.changes.map((c) => `- ${c}`));
    lines.push(`(Data through the last complete day; last synced ${metrics.lastSyncedAt ?? 'never'}.)`);
    sections.push({ key: 'metrics', title: 'Performance (stored daily metrics)', body: lines.join('\n') });
    sources.push('metrics');
  }

  // Projects and open work
  const projects = await Project.find({ clientId: cid })
    .select('name status tasks.name tasks.status tasks.endDate')
    .lean<{ name: string; status: string; tasks?: { name: string; status?: string; endDate?: Date }[] }[]>();
  if (projects.length) {
    const lines: string[] = [];
    for (const p of projects) {
      const open = (p.tasks ?? []).filter((t) => t.status !== 'completed');
      lines.push(`- ${p.name} (${p.status}): ${open.length} open task(s)`);
      const soonest = open
        .sort((a, b) => (a.endDate?.getTime() ?? Infinity) - (b.endDate?.getTime() ?? Infinity))
        .slice(0, 5);
      for (const t of soonest) lines.push(`  - ${t.name.slice(0, 120)}${t.endDate ? ` (due ${t.endDate.toISOString().slice(0, 10)})` : ''}${t.status === 'in-review' ? ' [in review]' : ''}`);
    }
    sections.push({ key: 'projects', title: 'Projects and open work', body: lines.join('\n') });
    sources.push('projects and tasks');

    const content = await ContentItem.find({
      projectId: { $in: (await Project.find({ clientId: cid }).select('_id').lean()).map((p) => p._id) },
      publishDate: { $gte: new Date(now.getTime() - 14 * 86_400_000), $lte: new Date(now.getTime() + 30 * 86_400_000) },
    })
      .select('title channel status publishDate')
      .sort({ publishDate: 1 })
      .limit(10)
      .lean<{ title: string; channel: string; status: string; publishDate?: Date }[]>();
    if (content.length) {
      sections.push({
        key: 'content',
        title: 'Content calendar (±2–4 weeks)',
        body: content.map((c) => `- ${c.publishDate?.toISOString().slice(0, 10) ?? 'unscheduled'} ${c.channel}: ${c.title.slice(0, 100)} [${c.status}]`).join('\n'),
      });
      sources.push('content calendar');
    }
  }

  // Recent actions and approvals
  const activity = (await listInvocations(viewer, companyId, { limit: 10 })) ?? [];
  if (activity.length) {
    sections.push({
      key: 'activity',
      title: 'Recent actions',
      body: activity.map((a) => `- ${a.createdAt.slice(0, 10)} ${a.title}: ${a.status}${a.summary ? ` — ${a.summary}` : a.error ? ` — ${a.error}` : ''}`).join('\n'),
    });
    sources.push('action receipts');
  }
  const pending = await CapabilityApproval.countDocuments({ organizationId: viewer.organizationId, companyId: cid, status: 'pending' });
  if (pending) {
    sections.push({ key: 'approvals', title: 'Waiting for approval', body: `${pending} action(s) are waiting for a manager's approval.` });
    sources.push('approvals');
  }

  // Enforce the budget: keep sections in priority order, truncating the last one that fits partially.
  const kept: ContextSection[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const s of sections) {
    const size = s.title.length + s.body.length + 8;
    if (used + size <= budget) {
      kept.push(s);
      used += size;
    } else if (budget - used > 400) {
      kept.push({ ...s, body: `${s.body.slice(0, budget - used - s.title.length - 30)}\n…(truncated)` });
      used = budget;
      omitted.push(`${s.title} (partially)`);
    } else {
      omitted.push(s.title);
    }
  }

  return {
    companyId,
    companyName: profile.name,
    hubProjectId: profile.hubProjectId ?? (await Project.findOne({ clientId: cid, projectType: 'client-admin' }).select('_id').lean())?._id?.toString() ?? null,
    sections: kept,
    sources,
    omitted,
  };
}

export function renderContext(ctx: { sections: ContextSection[] }): string {
  return ctx.sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n');
}

// ---------- Portfolio (all companies the viewer can access) ----------

/** Words too common to identify a company on their own. */
const GENERIC_WORDS = new Set([
  'the', 'shop', 'club', 'media', 'connect', 'content', 'home', 'end', 'demo', 'auto', 'intelligence', 'pay', 'app', 'store', 'agency', 'group', 'company',
]);

/** Companies a message refers to: full name, domain label, or a distinctive name word (5+ letters). */
export function detectCompanies(message: string, companies: CompanyProfile[]): CompanyProfile[] {
  const text = message.toLowerCase();
  const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
  return companies.filter((c) => {
    const name = c.name.toLowerCase();
    if (text.includes(name)) return true;
    const label = c.domain?.split('.')[0];
    if (label && label.length >= 4 && words.has(label)) return true;
    return name
      .split(/[^a-z0-9]+/)
      .some((w) => w.length >= 5 && !GENERIC_WORDS.has(w) && words.has(w));
  });
}

export interface PortfolioContext {
  sections: ContextSection[];
  sources: string[];
  omitted: string[];
  companies: CompanyProfile[];
  focused: string[];
}

export async function resolvePortfolioContext(
  viewer: CompanyViewer,
  options: { message: string; focusCompanyId?: string; budgetChars?: number; now?: Date }
): Promise<PortfolioContext> {
  const now = options.now ?? new Date();
  const budget = options.budgetChars ?? 12_000;
  const companies = await listCompanyProfiles(viewer);
  const overview = await getTodayOverview(viewer, { now });
  const byId = new Map(overview.rows.map((r) => [r.companyId, r]));

  const lines = companies.map((c) => {
    const row = byId.get(c.id);
    const rel = c.relationship === 'client' ? 'client' : c.relationship === 'internal' ? 'operating company' : 'own business';
    if (!row || Object.keys(row.metrics).length === 0) return `- ${c.name} (${rel}${c.domain ? `, ${c.domain}` : ''}): no metrics yet`;
    const parts = Object.entries(row.metrics).map(([key, m]) => {
      const label = key.replace(/_/g, ' ');
      const change = m.change === null ? '' : ` ${m.change >= 0 ? '+' : ''}${Math.round(m.change * 100)}%`;
      return `${label} ${fmt(m.unit, m.current)}${change}`;
    });
    return `- ${c.name} (${rel}${c.domain ? `, ${c.domain}` : ''}): ${parts.join('; ')}${row.changes[0] ? `. Note: ${row.changes[0]}` : ''}`;
  });
  const sections: ContextSection[] = [
    {
      key: 'portfolio',
      title: 'All companies (last 7 complete days; % = change vs the 7 before; subscribers/MRR are current)',
      body: lines.join('\n') || 'No companies yet.',
    },
  ];
  const sources = ['portfolio overview'];

  const focusIds = [
    ...(options.focusCompanyId && companies.some((c) => c.id === options.focusCompanyId) ? [options.focusCompanyId] : []),
    ...detectCompanies(options.message, companies).map((c) => c.id),
  ].filter((id, i, all) => all.indexOf(id) === i);
  const focused = focusIds.slice(0, 2);
  const omitted: string[] = focusIds.slice(2).map((id) => `${companies.find((c) => c.id === id)?.name} detail (ask about it directly)`);

  let used = sections[0].body.length + sections[0].title.length;
  const perCompany = Math.max(1500, Math.floor((budget - used) / Math.max(focused.length, 1)));
  for (const id of focused) {
    const detail = await resolveCompanyContext(viewer, id, { budgetChars: perCompany, now });
    if (!detail) continue;
    for (const s of detail.sections) sections.push({ ...s, key: `${id}:${s.key}`, title: `${detail.companyName}: ${s.title}` });
    sources.push(...detail.sources.map((s) => `${detail.companyName} ${s}`));
    omitted.push(...detail.omitted.map((o) => `${detail.companyName} ${o}`));
    used += perCompany;
  }
  return { sections, sources, omitted, companies, focused };
}
