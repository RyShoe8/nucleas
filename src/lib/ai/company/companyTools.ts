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
import { listResponsibilities } from '@/lib/work/responsibilities';
import { workRegisterOutput } from '@/lib/work/registerOutput';
import { TEAM, teamRoleFor } from '@/lib/companies/teamRoles';
import { cachedLookup } from '@/lib/seo/cache';
import { keywordIdeas } from '@/lib/seo/keywordIdeas';
import { pageOutline } from '@/lib/seo/pageOutline';

/**
 * Portfolio assistant tools. Every tool takes a `company` argument restricted to the companies the
 * viewer can access; the model never sees credentials or provider endpoints. Each call runs through
 * the capability runtime (policy, approvals, receipts attributed to that company and the AI run).
 * Sensitive capabilities are withheld.
 */

const MAX_TOOL_OUTPUT = 6000;
/** SEO lookups return long lists; the writer still gets a compact version through the fact sheet. */
const MAX_SEO_OUTPUT = 14000;
/** Free SEO sources are cached for the organization this long. */
const KEYWORD_IDEAS_DAYS = 30;
const SERP_CAPABILITY = 'search.results.read';
const PAGE_OUTLINE_DAYS = 14;

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
      owner: job.ownerName ?? TEAM[job.teamRole ?? teamRoleFor(job)]?.name,
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
  if (def.toolDescription) return def.toolDescription;
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
      type: 'function', function: {
        name: 'company_animation',
        description: 'Rigby2D animation projects in Nucleas. List company animation assets, or inspect an asset by assetId. Only when the user requests animation edits, provide operations to save a NEW draft version for review in Creative → Animation Studio. Never publishes. Operations is a JSON array of Rigby edits: add_animation {name}; add_bone {name,parent,x,y}; set_bone_setup {bone,x,y,rotation}; set_bone_key {animation,bone,channel:rotate|translate|scale,time,value (rotate) or x/y (translate/scale),curve}; set_attachment_key {animation,slot,time,attachment}; set_event_key {animation,event,time}. Inspect first for exact bone/slot/animation names. No filesystem paths or scripts.',
        parameters: { type:'object',properties:{company:companyParam,assetId:{type:'string',description:'Saved animation Asset ID; omit to list.'},operations:{type:'string',description:'JSON array of up to 64 requested animation edits; omit for inspection.'}},required:['company'] },
      },
    },
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
    {
      type: 'function',
      function: {
        name: 'keyword_ideas',
        description:
          "Keyword ideas for a seed phrase from Google's autocomplete (free, cached 30 days): what people actually type after it, expanded with question words, comparisons and a-z, plus the ones phrased as questions. No search volumes. Use it for keyword discovery and long-tail ideas before spending paid searches.",
        parameters: {
          type: 'object',
          properties: {
            seed: { type: 'string', description: 'Seed phrase, e.g. "slot machine odds"' },
            country: { type: 'string', description: 'Two-letter country code (default us)' },
            language: { type: 'string', description: 'Language code (default en)' },
            expand: { type: 'boolean', description: 'Expand with question words, comparisons and a-z (default true); false returns only direct completions' },
          },
          required: ['seed'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'page_outline',
        description:
          "The SEO structure of any public page (free, cached 14 days): title, meta description, canonical, H1-H3 headings in order, word count, internal and external links, images missing alt text, structured data types and published/modified dates. Read through the real browser, so JavaScript sites work. Use it on the pages that rank for a keyword to build a content brief, or on the company's own page to compare.",
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'Full https URL of the page' } },
          required: ['url'],
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
            ...Object.fromEntries(Object.entries(d.toolParameters ?? {}).map(([key, { required: _required, ...schema }]) => [key, schema])),
            ...(d.id === SERP_CAPABILITY ? { outlineTop: { type: 'integer', description: 'Also read the SEO outline (headings, length, structured data) of the top N organic results, 0-5 (default 0)' } } : {}),
          },
          required: ['company', ...Object.entries(d.toolParameters ?? {}).filter(([, spec]) => spec.required).map(([key]) => key)],
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
      const responsibilities = (await listResponsibilities(viewer, one?.id, args.includeFinished === true)).map(r => ({ id: r.id, company: r.companyName, outcome: r.agreement.outcome, owner: r.agreement.role, assignedMemberId: r.agreement.assignedMemberId, status: r.status, totalTargets: r.targets.length, verifiedTargets: r.targets.filter(t => t.status === 'current').length, awaitingReview: r.targets.filter(t => ['review', 'blocked'].includes(t.status)).length, error: r.error, monthlyBudgetUsd: r.monthlyBudgetMicros / 1e6, recordedThisMonthUsd: r.recordedMicros / 1e6, reservedUsd: r.reservedMicros / 1e6, unverifiedCostReservations: r.unknownReservations }));
      return workRegisterOutput({ scope: one ? one.name : 'all companies', jobs: summarizeJobs(jobs), responsibilities, registerLimitReached: jobs.length >= 200 });
    }

    if (name === 'keyword_ideas') {
      const seed = typeof args.seed === 'string' ? args.seed : '';
      const country = typeof args.country === 'string' && /^[a-z]{2}$/i.test(args.country) ? args.country.toLowerCase() : 'us';
      const language = typeof args.language === 'string' && /^[a-z]{2}(-[a-z]{2})?$/i.test(args.language) ? args.language.toLowerCase() : 'en';
      const expand = args.expand !== false;
      try {
        const key = [seed.toLowerCase().replace(/\s+/g, ' ').trim(), country, language, expand ? 'expand' : 'direct'].join('|');
        const found = await cachedLookup(viewer.organizationId, 'keyword_ideas', key, KEYWORD_IDEAS_DAYS, () => keywordIdeas({ seed, country, language, expand }, { fetchImpl: options.fetchImpl }));
        return JSON.stringify({ ok: true, cached: found.cached, fetchedAt: found.fetchedAt, ...found.data }).slice(0, MAX_SEO_OUTPUT);
      } catch (error) {
        return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Could not get keyword ideas.' });
      }
    }

    if (name === 'page_outline') {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      try {
        const found = await cachedLookup(viewer.organizationId, 'page_outline', url.toLowerCase(), PAGE_OUTLINE_DAYS, () => pageOutline(url, { fetchImpl: options.fetchImpl }));
        return JSON.stringify({ ok: true, cached: found.cached, fetchedAt: found.fetchedAt, ...found.data }).slice(0, MAX_SEO_OUTPUT);
      } catch (error) {
        // Never an empty outline: say the page could not be read.
        return JSON.stringify({ ok: false, url, error: `Could not read the page: ${error instanceof Error ? error.message : 'unknown error'}` });
      }
    }

    const company = matchCompany(companies, args.company);
    if (!company) {
      return JSON.stringify({ ok: false, error: 'Unknown or inaccessible company. Call list_companies for valid names.' });
    }

    if (name === 'company_animation') {
      try {
        const { companyAnimation } = await import('@/lib/animation/companyAnimation');
        return JSON.stringify({ok:true,result:await companyAnimation(viewer,company.id,{assetId:typeof args.assetId==='string'?args.assetId:undefined,operations:typeof args.operations==='string'?args.operations:undefined})}).slice(0,MAX_SEO_OUTPUT);
      } catch(error) { return JSON.stringify({ok:false,error:error instanceof Error?error.message:'Animation operation failed.'}); }
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
    const input: Record<string, unknown> = takesDays(def) && typeof args.days === 'number' ? { days: Math.round(args.days) } : {};
    // Declared extra arguments pass through as given; the capability's own schema checks them.
    for (const [key, spec] of Object.entries(def.toolParameters ?? {})) {
      const value = args[key];
      if (value === undefined || value === null || value === '') continue;
      input[key] = spec.type === 'integer' && typeof value === 'number' ? Math.round(value) : value;
    }
    const res = await invokeCapability(viewer, company.id, def.id, input, { aiRunId: String(context.runId), registry, fetchImpl: options.fetchImpl });
    if (!res.ok) return JSON.stringify({ ok: false, company: company.name, error: res.error });
    const inv = res.invocation;
    invocationIds.push(inv.id);
    // The pages that rank, read in the same call so one request gives a whole content brief.
    const outlineTop = def.id === SERP_CAPABILITY && typeof args.outlineTop === 'number' ? Math.min(Math.max(Math.round(args.outlineTop), 0), 5) : 0;
    const organic = (inv.output as { organic?: { url: string }[] } | null)?.organic ?? [];
    const outlines = outlineTop && (inv.status === 'succeeded' || inv.status === 'verified')
      ? await Promise.all(organic.slice(0, outlineTop).map(async ({ url }) => {
          try {
            return { ok: true, ...(await cachedLookup(viewer.organizationId, 'page_outline', url.toLowerCase(), PAGE_OUTLINE_DAYS, () => pageOutline(url, { fetchImpl: options.fetchImpl }))).data };
          } catch (error) {
            return { ok: false, url, error: `Could not read the page: ${error instanceof Error ? error.message : 'unknown error'}` };
          }
        }))
      : undefined;
    return JSON.stringify({
      ok: inv.status === 'succeeded' || inv.status === 'verified',
      company: company.name,
      status: inv.status,
      summary: inv.summary,
      error: inv.error,
      awaitingApproval: inv.status === 'pending_approval' ? 'A manager must approve this in the Activity list before it runs.' : undefined,
      output: inv.output,
      ...(outlines ? { outlines } : {}),
    }).slice(0, def.toolParameters ? (outlines ? MAX_SEO_OUTPUT * 2 : MAX_SEO_OUTPUT) : MAX_TOOL_OUTPUT);
  }

  return { toolSet: { definitions, execute }, invocationIds };
}
