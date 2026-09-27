import { Types } from 'mongoose';
import { IntegrationConnection } from '@/lib/models/Integration';
import { listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import {
  getIntegrationProvider,
  OWNED_COMPANY_BASELINE_PROVIDERS,
  providersFromStacks,
} from '@/lib/integrations/providers';

/**
 * Declares (status `declared`) the integrations each company is known to use: the confirmed
 * baseline for owned/internal companies plus anything recorded in their stacks. Existing
 * connections are never modified, so re-running after connecting is safe.
 */

export interface DeclaredConnectionPlanItem {
  companyId: string | null;
  companyName: string;
  provider: string;
  scope: 'org' | 'company';
  source: 'baseline' | 'stack_backfill';
  exists: boolean;
}

export interface DeclarePlan {
  items: DeclaredConnectionPlanItem[];
  unmappedTools: Record<string, string[]>;
}

/** Org-scoped accounts we hold regardless of stacks. */
const ORG_BASELINE_PROVIDERS = ['ahrefs'];

export async function planDeclaredConnections(organizationId: Types.ObjectId): Promise<DeclarePlan> {
  // Planning runs as an administrator view of the org: every company, no team filter.
  const viewer: CompanyViewer = { userId: '', organizationId, employeeId: null, role: 'Administrator' };
  const companies = await listCompanyProfiles(viewer);

  const wanted = new Map<string, Omit<DeclaredConnectionPlanItem, 'exists'>>();
  const unmappedTools: Record<string, string[]> = {};
  const add = (item: Omit<DeclaredConnectionPlanItem, 'exists'>) => {
    const key = `${item.companyId ?? 'org'}:${item.provider}`;
    const current = wanted.get(key);
    // Prefer 'baseline' as the recorded source when both apply.
    if (!current || (current.source === 'stack_backfill' && item.source === 'baseline')) wanted.set(key, item);
  };

  for (const provider of ORG_BASELINE_PROVIDERS) {
    add({ companyId: null, companyName: '(organization)', provider, scope: 'org', source: 'baseline' });
  }

  for (const company of companies) {
    const { providerIds, unmapped } = providersFromStacks(company.stackToolIds);
    if (unmapped.length) unmappedTools[company.name] = unmapped;

    const baseline = company.relationship === 'client' ? [] : [...OWNED_COMPANY_BASELINE_PROVIDERS];
    for (const providerId of [...baseline, ...providerIds]) {
      const def = getIntegrationProvider(providerId);
      if (!def) continue;
      const source = (baseline as string[]).includes(providerId) ? 'baseline' : 'stack_backfill';
      if (def.defaultScope === 'org') {
        add({ companyId: null, companyName: '(organization)', provider: providerId, scope: 'org', source });
      } else {
        add({ companyId: company.id, companyName: company.name, provider: providerId, scope: 'company', source });
      }
    }
  }

  const existing = await IntegrationConnection.find({ organizationId }).select('companyId provider').lean();
  const existingKeys = new Set(existing.map((c) => `${c.companyId ? String(c.companyId) : 'org'}:${c.provider}`));

  const items = [...wanted.entries()]
    .map(([key, item]) => ({ ...item, exists: existingKeys.has(key) }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName) || a.provider.localeCompare(b.provider));
  return { items, unmappedTools };
}

export async function applyDeclaredConnections(organizationId: Types.ObjectId): Promise<{ created: number; existing: number; plan: DeclarePlan }> {
  const plan = await planDeclaredConnections(organizationId);
  let created = 0;
  let existing = 0;
  for (const item of plan.items) {
    const res = await IntegrationConnection.updateOne(
      {
        organizationId,
        companyId: item.companyId ? new Types.ObjectId(item.companyId) : null,
        provider: item.provider,
      },
      {
        $setOnInsert: {
          scope: item.scope,
          status: 'declared',
          source: item.source,
          grantedScopes: [],
          revision: 0,
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount === 1) created += 1;
    else existing += 1;
  }
  return { created, existing, plan };
}
