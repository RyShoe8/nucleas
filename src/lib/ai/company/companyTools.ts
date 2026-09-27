import { Types } from 'mongoose';
import type { ToolDefinition } from '@nucleas/ai-contracts';
import { IntegrationConnection } from '@/lib/models/Integration';
import { CAPABILITIES } from '@/lib/capabilities/registry';
import { invokeCapability } from '@/lib/capabilities/runtime';
import type { CapabilityDefinition } from '@/lib/capabilities/types';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { getCompanyMetrics } from '@/lib/metrics/query';
import type { ExtraToolSet } from '@/lib/ai/tools/runToolLoop';

/**
 * Company capabilities exposed to the model as tools. The company is fixed by the caller — the
 * model cannot choose another company, see credentials or call provider endpoints. Every call goes
 * through the capability runtime (policy, approvals, receipts). Sensitive capabilities are withheld.
 */

const MAX_TOOL_OUTPUT = 6000;

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
  return `${def.title} (${def.domain}). ${effect}`;
}

export interface CompanyToolRun {
  toolSet: ExtraToolSet;
  /** Receipts created during the turn, in order. */
  invocationIds: string[];
}

export async function buildCompanyTools(
  viewer: CompanyViewer,
  companyId: string,
  options: { registry?: CapabilityDefinition[]; fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> } = {}
): Promise<CompanyToolRun> {
  const registry = options.registry ?? CAPABILITIES;
  const connected = new Set(
    (
      await IntegrationConnection.find({
        organizationId: viewer.organizationId,
        status: 'connected',
        $or: [{ companyId: new Types.ObjectId(companyId) }, { companyId: null }],
      })
        .select('provider')
        .lean<{ provider: string }[]>()
    ).map((c) => c.provider)
  );

  const offered = registry.filter((d) => !d.sensitive && connected.has(d.provider));
  const byName = new Map(offered.map((d) => [toolNameFor(d.id), d]));
  const invocationIds: string[] = [];

  const definitions: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'company_metrics',
        description:
          'Stored daily metrics for this company (traffic, search, leads, users, customers, revenue, subscribers) with 7-day totals, prior-7-day comparison and notable changes. Fast; prefer this for performance questions.',
        parameters: {
          type: 'object',
          properties: { days: { type: 'integer', description: 'History window in days (14–90, default 28)' } },
          required: [],
        },
      },
    },
    ...offered.map((d) => ({
      type: 'function' as const,
      function: {
        name: toolNameFor(d.id),
        description: describe(d),
        parameters: takesDays(d)
          ? { type: 'object', properties: { days: { type: 'integer', description: 'Days of history (1–365, default 28)' } }, required: [] }
          : { type: 'object', properties: {}, required: [] },
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

    if (name === 'company_metrics') {
      const days = typeof args.days === 'number' ? Math.min(Math.max(Math.round(args.days), 14), 90) : 28;
      const view = await getCompanyMetrics(viewer, companyId, { days });
      if (!view) return JSON.stringify({ ok: false, error: 'Company not found.' });
      return JSON.stringify({
        ok: true,
        lastSyncedAt: view.lastSyncedAt,
        notableChanges: view.changes,
        metrics: view.metrics.map((m) => ({
          key: m.key,
          label: m.label,
          unit: m.unit === 'money' ? 'USD cents' : m.unit,
          kind: m.kind,
          last7OrCurrent: m.current,
          previous: m.previous,
          change: m.change === null ? null : Math.round(m.change * 1000) / 10,
          recentDays: m.kind === 'daily' ? m.series.slice(-14) : m.series.slice(-4),
        })),
      }).slice(0, MAX_TOOL_OUTPUT);
    }

    const def = byName.get(name);
    if (!def) return JSON.stringify({ ok: false, error: 'Unknown tool.' });
    const input = takesDays(def) && typeof args.days === 'number' ? { days: Math.round(args.days) } : {};
    const res = await invokeCapability(viewer, companyId, def.id, input, { aiRunId: String(context.runId), registry, fetchImpl: options.fetchImpl });
    if (!res.ok) return JSON.stringify({ ok: false, error: res.error });
    const inv = res.invocation;
    invocationIds.push(inv.id);
    return JSON.stringify({
      ok: inv.status === 'succeeded' || inv.status === 'verified',
      status: inv.status,
      summary: inv.summary,
      error: inv.error,
      awaitingApproval: inv.status === 'pending_approval' ? 'A manager must approve this in the Activity list before it runs.' : undefined,
      output: inv.output,
    }).slice(0, MAX_TOOL_OUTPUT);
  }

  return { toolSet: { definitions, execute }, invocationIds };
}
