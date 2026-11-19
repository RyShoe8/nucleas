import { companyTimeline } from '@/lib/companies/activityLog';
import { Types } from 'mongoose';
import type { ToolDefinition } from '@nucleas/ai-contracts';
import { IntegrationConnection } from '@/lib/models/Integration';
import { CAPABILITIES } from '@/lib/capabilities/registry';
import { invokeCapability } from '@/lib/capabilities/runtime';
import type { CapabilityDefinition } from '@/lib/capabilities/types';
import type { CompanyProfile, CompanyViewer } from '@/lib/companies/companyProfile';
import { getCompanyMetrics } from '@/lib/metrics/query';
import type { ExtraToolSet } from '@/lib/ai/tools/runToolLoop';
import { listJobs, type JobView } from '@/lib/jobs/jobs';
import { TEAM, teamRoleFor } from '@/lib/companies/teamRoles';

/**
 * Portfolio assistant tools. Every tool takes a `company` argument restricted to the companies the
 * viewer can access; the model never sees credentials or provider endpoints. Each call runs through
 * the capability runtime (policy, approvals, receipts attributed to that company and the AI run).
 * Sensitive capabilities are withheld.
 */

const MAX_TOOL_OUTPUT = 6000;
const MAX_JOBS_OUTPUT = 16000;

/** The jobs as the assistant needs them: grouped by company, one compact line of facts per job. */
export function summarizeJobs(jobs: JobView[]) {
  const scheduleOf = (job: JobView) => {
    const s = job.design?.schedule;
    if (!s || s.kind === 'once') return 'once';
    if (s.kind === 'hourly') return 'every hour';
    if (s.kind === 'daily') return s.everyDays && s.everyDays > 1 ? `every ${s.everyDays} days` : `daily${s.time ? ` at ${s.time}` : ''}`;
    if (s.kind === 'weekly') return `weekly${s.time ? ` at ${s.time}` : ''}`;
    return 'monthly';
  };
  const waitingFor = (job: JobView) => {
    const items: string[] = [];
    if (job.status === 'needs_answers') items.push('answers to its questions');
    if (job.status === 'proposed') items.push('approval of its plan');
    const reviews = job.runs.filter((r) => r.status === 'needs_review').length;
    if (reviews) items.push(`${reviews} result${reviews === 1 ? '' : 's'} to review`);
    const posts = job.publishing?.ready.filter((d) => d.status === 'ready').length ?? 0;
    if (posts) items.push(`${posts} post${posts === 1 ? '' : 's'} or record${posts === 1 ? '' : 's'} to handle`);
    const links = job.opportunities.filter((o) => o.status === 'recommended' || o.status === 'approved').length;
    if (links) items.push(`${links} link opportunit${links === 1 ? 'y' : 'ies'}`);
    return items;
  };
  const byCompany = new Map<string, ReturnType<typeof line>[]>();
  function line(job: JobView) {
    const running = job.runs.find((r) => r.status === 'running');
    return {
      name: job.design?.title ?? job.request.slice(0, 120),
      owner: TEAM[job.teamRole ?? teamRoleFor(job)]?.name,
      status: running ? `working now (${running.progressState.label})` : job.status,
      schedule: scheduleOf(job),
      lastRun: job.lastRunAt,
      nextRun: job.status === 'active' ? job.nextRunAt : null,
      waitingForYou: waitingFor(job),
      resultsGoOut: job.publishing
        ? job.publishing.channels.map((c) => `${c.platform}: ${c.mode === 'auto' ? 'automatic' : 'waits for a person'}`).join(', ')
        : job.completion === 'automatic' ? 'counted automatically when every check passes' : job.completion === 'review' ? 'a person reviews each result' : null,
      spentThisMonthUsd: Math.round(job.spentThisMonthMicros / 10_000) / 100,
    };
  }
  for (const job of jobs) {
    const list = byCompany.get(job.companyName) ?? [];
    list.push(line(job));
    byCompany.set(job.companyName, list);
  }
  return [...byCompany.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([company, list]) => ({ company, count: list.length, jobs: list }));
}

export function toolNameFor(capabilityId: string): string {
  return capabilityId.replace(/[^a-zA-Z0-9]+/g, '_');
}

/** True when the capability accepts an optional `days` window. */
function takesDays(def: CapabilityDefinition): boolean {
  return def.input.safeParse({ days: 7 }).success && def.input.safeParse({}).success && !def.input.safeParse({ unexpected: 1 }).success;
}

function describe(def: CapabilityDefinition): string {
  const effect =
    def.kind === 'read'
      ? 'Reads live data.'
      : def.approval === 'required'
        ? 'Makes a change; waits for a manager to approve before it runs.'
        : 'Makes a change (low risk, verified afterwards).';
  return `${def.title} (${def.domain}) for one company. ${effect}`;
}

/** Resolves a model-supplied company reference (name, domain or id) to an accessible company. */
export function matchCompany(companies: CompanyProfile[], ref: unknown): CompanyProfile | null {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const q = ref.trim().toLowerCase();
  return (
    companies.find((c) => c.id === ref.trim()) ??
    companies.find((c) => c.name.toLowerCase() === q) ??
    companies.find((c) => c.domain && (c.domain === q || q.includes(c.domain))) ??
    null
  );
}

export interface AssistantToolRun {
  toolSet: ExtraToolSet;
  /** Receipts created during the turn, in order. */
  invocationIds: string[];
}

export async function buildAssistantTools(
  viewer: CompanyViewer,
  companies: CompanyProfile[],
  options: { registry?: CapabilityDefinition[]; fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> } = {}
): Promise<AssistantToolRun> {
  const registry = options.registry ?? CAPABILITIES;
  const connections = await IntegrationConnection.find({ organizationId: viewer.organizationId, status: 'connected' })
    .select('provider companyId')
    .lean<{ provider: string; companyId?: Types.ObjectId | null }[]>();
  const accessible = new Set(companies.map((c) => c.id));
  const connectedFor = (companyId: string) =>
    new Set(connections.filter((c) => !c.companyId || String(c.companyId) === companyId).map((c) => c.provider));
  const anyConnected = new Set(connections.filter((c) => !c.companyId || accessible.has(String(c.companyId))).map((c) => c.provider));

  const offered = registry.filter((d) => !d.sensitive && anyConnected.has(d.provider));
  const byName = new Map(offered.map((d) => [toolNameFor(d.id), d]));
  const invocationIds: string[] = [];
  const companyParam = {
    type: 'string',
    description: 'Company name exactly as listed by list_companies',
    ...(companies.length ? { enum: companies.map((c) => c.name) } : {}),
  };

  const definitions: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'list_companies',
        description: 'Companies the user can access, with relationship, domain and which systems are connected.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'company_metrics',
        description:
          'Stored daily metrics for one company (traffic, search, leads, users, customers, revenue, ad revenue, subscribers) with 7-day totals, prior-7-day comparison and notable changes. Fast; prefer this for performance questions.',
        parameters: {
          type: 'object',
          properties: { company: companyParam, days: { type: 'integer', description: 'History window in days (14–90, default 28)' } },
          required: ['company'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'nucleas_jobs',
        description:
          "Nucleas's own jobs (responsibilities): every automated or one-off job it runs for the companies, with its team member, status (active, paused, waiting for approval…), schedule, last and next run, what is waiting for a person, how results go out, and this month's spend. Leave company out, or pass \"all\", for every company. Use it for any question about what Nucleas is running, has set up, or needs reviewed.",
        parameters: {
          type: 'object',
          properties: { company: { type: 'string', description: 'One company name from list_companies, or "all" (the default) for every company' }, includeFinished: { type: 'boolean', description: 'Also list finished, failed and rejected jobs (default false)' } },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'company_activity',
        description:
          'What changed recently for one company, newest first: code commits, builds and pull requests, actions Nucleas took in connected systems, and integration changes. Use it to explain recent movements or check what was just changed.',
        parameters: {
          type: 'object',
          properties: { company: companyParam, limit: { type: 'integer', description: 'How many changes (default 30, max 100)' } },
          required: ['company'],
        },
      },
    },
    ...offered.map((d) => ({
      type: 'function' as const,
      function: {
        name: toolNameFor(d.id),
        description: describe(d),
        parameters: {
          type: 'object',
          properties: {
            company: companyParam,
            ...(takesDays(d) ? { days: { type: 'integer', description: 'Days of history (1–365, default 28)' } } : {}),
          },
          required: ['company'],
        },
      },
    })),
  ];

  async function execute(name: string, argumentsJson: string, context: { runId: Types.ObjectId }): Promise<string> {
    let args: Record<string, unknown> = {};
    try {
      const parsed = argumentsJson ? JSON.parse(argumentsJson) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      return JSON.stringify({ ok: false, error: 'Arguments must be a JSON object.' });
    }

    if (name === 'list_companies') {
      return JSON.stringify({
        ok: true,
        companies: companies.map((c) => ({
          name: c.name,
          relationship: c.relationship,
          domain: c.domain ?? null,
          connected: [...connectedFor(c.id)].sort(),
        })),
      }).slice(0, MAX_TOOL_OUTPUT);
    }

    if (name === 'nucleas_jobs') {
      const one = matchCompany(companies, args.company);
      const jobs = await listJobs(viewer, { ...(one ? { companyId: one.id } : {}), includeClosed: args.includeFinished === true });
      return JSON.stringify({ ok: true, scope: one ? one.name : 'all companies', jobs: summarizeJobs(jobs) }).slice(0, MAX_JOBS_OUTPUT);
    }

    const company = matchCompany(companies, args.company);
    if (!company) {
      return JSON.stringify({ ok: false, error: 'Unknown or inaccessible company. Call list_companies for valid names.' });
    }

    if (name === 'company_activity') {
      const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.round(args.limit), 1), 100) : 30;
      const items = await companyTimeline(viewer, company.id, { limit });
      if (!items) return JSON.stringify({ ok: false, error: 'Company not found.' });
      return JSON.stringify({ ok: true, company: company.name, changes: items }).slice(0, MAX_TOOL_OUTPUT);
    }

    if (name === 'company_metrics') {
      const days = typeof args.days === 'number' ? Math.min(Math.max(Math.round(args.days), 14), 90) : 28;
      const view = await getCompanyMetrics(viewer, company.id, { days });
      if (!view) return JSON.stringify({ ok: false, error: 'Company not found.' });
      return JSON.stringify({
        ok: true,
        company: company.name,
        lastSyncedAt: view.lastSyncedAt,
        notableChanges: view.changes,
        metrics: view.metrics.map((m) => ({
          key: m.key,
          label: m.label,
          unit: m.unit === 'money' ? `${m.currency ?? 'unknown currency'} minor units` : m.unit,
          coverage: m.coverage,
          warning: m.warning,
          source: m.source,
          asOf: m.asOf,
          kind: m.kind,
          last7OrCurrent: m.warning ? null : m.current,
          previous: m.previous,
          changePct: m.change === null ? null : Math.round(m.change * 1000) / 10,
          recentDays: m.kind === 'daily' ? m.series.slice(-14) : m.series.slice(-4),
        })),
      }).slice(0, MAX_TOOL_OUTPUT);
    }

    const def = byName.get(name);
    if (!def) return JSON.stringify({ ok: false, error: 'Unknown tool.' });
    const input = takesDays(def) && typeof args.days === 'number' ? { days: Math.round(args.days) } : {};
    const res = await invokeCapability(viewer, company.id, def.id, input, { aiRunId: String(context.runId), registry, fetchImpl: options.fetchImpl });
    if (!res.ok) return JSON.stringify({ ok: false, company: company.name, error: res.error });
    const inv = res.invocation;
    invocationIds.push(inv.id);
    return JSON.stringify({
      ok: inv.status === 'succeeded' || inv.status === 'verified',
      company: company.name,
      status: inv.status,
      summary: inv.summary,
      error: inv.error,
      awaitingApproval: inv.status === 'pending_approval' ? 'A manager must approve this in the Activity list before it runs.' : undefined,
      output: inv.output,
    }).slice(0, MAX_TOOL_OUTPUT);
  }

  return { toolSet: { definitions, execute }, invocationIds };
}
