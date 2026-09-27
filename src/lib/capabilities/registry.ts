import { z } from 'zod';
import { CapabilityError, type CapabilityDefinition } from './types';
import { defaultRange } from './adapters/http';
import { ga4Traffic, gscPerformance, type SearchOutput, type TrafficOutput } from './adapters/google';
import { brevoAudience, mercuryCash, stripeRevenue, type CashOutput, type EmailAudienceOutput, type RevenueOutput } from './adapters/commerce';
import { ahrefsOverview, ensureAhrefsProject, findProjectForDomain, listAhrefsProjects, type SeoOverviewOutput } from './adapters/ahrefs';

export const SEARCH_LAG_DAYS = 2;

const daysInput = z.object({ days: z.number().int().min(1).max(365).default(28) }).strict();
type DaysInput = z.infer<typeof daysInput>;

function requireDomain(domain: string | undefined): string {
  if (!domain) throw new CapabilityError('needs_setup', 'This company has no production domain yet.');
  return domain;
}

const analyticsTraffic: CapabilityDefinition<DaysInput, TrafficOutput> = {
  id: 'analytics.traffic.read',
  version: 1,
  title: 'Website traffic',
  domain: 'analytics',
  kind: 'read',
  risk: 'read',
  approval: 'auto',
  provider: 'ga4',
  requiresResource: 'property',
  input: daysInput,
  cacheSeconds: 600,
  async run(ctx, input) {
    const output = await ga4Traffic(ctx, defaultRange(input.days, ctx.now));
    return { output, summary: `${output.totals.sessions.toLocaleString('en-US')} sessions over ${input.days} days` };
  },
};

const searchPerformance: CapabilityDefinition<DaysInput, SearchOutput> = {
  id: 'search.performance.read',
  version: 1,
  title: 'Search performance',
  domain: 'search',
  kind: 'read',
  risk: 'read',
  approval: 'auto',
  provider: 'gsc',
  requiresResource: 'site',
  input: daysInput,
  cacheSeconds: 600,
  async run(ctx, input) {
    // Search Console data lags ~2 days; ask for the window ending 2 days ago.
    const output = await gscPerformance(ctx, defaultRange(input.days, ctx.now, SEARCH_LAG_DAYS));
    return { output, summary: `${output.totals.clicks.toLocaleString('en-US')} clicks, ${output.totals.impressions.toLocaleString('en-US')} impressions` };
  },
};

const emailAudience: CapabilityDefinition<DaysInput, EmailAudienceOutput> = {
  id: 'email.audience.read',
  version: 1,
  title: 'Email audience',
  domain: 'email',
  kind: 'read',
  risk: 'read',
  approval: 'auto',
  provider: 'brevo',
  input: daysInput,
  cacheSeconds: 600,
  async run(ctx, input) {
    const output = await brevoAudience(ctx, { startDate: defaultRange(input.days, ctx.now).startDate });
    return { output, summary: `${output.totalContacts.toLocaleString('en-US')} contacts, ${output.newContacts} new in ${input.days} days` };
  },
};

const paymentsRevenue: CapabilityDefinition<DaysInput, RevenueOutput> = {
  id: 'payments.revenue.read',
  version: 1,
  title: 'Revenue',
  domain: 'payments',
  kind: 'read',
  risk: 'read',
  approval: 'auto',
  provider: 'stripe',
  input: daysInput,
  cacheSeconds: 600,
  async run(ctx, input) {
    const output = await stripeRevenue(ctx, defaultRange(input.days, ctx.now));
    return { output, summary: `${output.payments} payments, ${output.newCustomers} new customers, ${output.activeSubscriptions} active subscriptions` };
  },
};

const financeCash: CapabilityDefinition<Record<string, never>, CashOutput> = {
  id: 'finance.cash.read',
  version: 1,
  title: 'Cash balances',
  domain: 'finance',
  kind: 'read',
  risk: 'read',
  approval: 'auto',
  provider: 'mercury',
  sensitive: true,
  input: z.object({}).strict(),
  cacheSeconds: 300,
  async run(ctx) {
    const output = await mercuryCash(ctx);
    return { output, summary: `${output.accounts.length} account(s)` };
  },
};

const seoOverview: CapabilityDefinition<Record<string, never>, SeoOverviewOutput> = {
  id: 'seo.overview.read',
  version: 1,
  title: 'SEO overview',
  domain: 'seo',
  kind: 'read',
  risk: 'read',
  approval: 'auto',
  provider: 'ahrefs',
  input: z.object({}).strict(),
  cacheSeconds: 3600,
  async run(ctx) {
    const output = await ahrefsOverview(ctx, requireDomain(ctx.companyDomain), ctx.now);
    return { output, summary: `DR ${output.domainRating ?? '-'}, ${output.organicKeywords ?? '-'} organic keywords` };
  },
};

const seoProjectCreate: CapabilityDefinition<Record<string, never>, { projectId: string; created: boolean }> = {
  id: 'seo.project.create',
  version: 1,
  title: 'Set up SEO tracking',
  domain: 'seo',
  kind: 'write',
  risk: 'low_write',
  approval: 'auto',
  provider: 'ahrefs',
  input: z.object({}).strict(),
  async run(ctx) {
    const domain = requireDomain(ctx.companyDomain);
    const { project, created } = await ensureAhrefsProject(ctx, { domain, name: domain });
    return {
      output: { projectId: String(project.project_id), created },
      resource: {
        resourceType: 'project',
        externalId: String(project.project_id),
        label: project.project_name,
        externalUrl: `https://app.ahrefs.com/rank-tracker/overview/${encodeURIComponent(String(project.project_id))}`,
      },
      summary: created ? `Created Ahrefs project for ${domain}` : `Ahrefs project for ${domain} already existed`,
    };
  },
  async verify(ctx, _input, result) {
    const found = findProjectForDomain(await listAhrefsProjects(ctx), requireDomain(ctx.companyDomain));
    return Boolean(found && String(found.project_id) === result.resource?.externalId);
  },
};

export const CAPABILITIES: CapabilityDefinition[] = [
  analyticsTraffic,
  searchPerformance,
  emailAudience,
  paymentsRevenue,
  financeCash,
  seoOverview,
  seoProjectCreate,
] as CapabilityDefinition[];

export function getCapability(id: string, registry: CapabilityDefinition[] = CAPABILITIES): CapabilityDefinition | undefined {
  return registry.find((c) => c.id === id);
}
