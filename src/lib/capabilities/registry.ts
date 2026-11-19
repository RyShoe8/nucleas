import { admanagerRevenue, type AdxOutput } from './adapters/admanager';
import { z } from 'zod';
import { CapabilityError, type CapabilityDefinition } from './types';
import { defaultRange } from './adapters/http';
import { ga4Traffic, gscPerformance, type SearchOutput, type TrafficOutput } from './adapters/google';
import { brevoAudience, mercuryCash, stripeRevenue, type CashOutput, type EmailAudienceOutput, type RevenueOutput } from './adapters/commerce';
import { adsenseRevenue, type AdRevenueOutput } from './adapters/adsense';
import { searchOpportunities, type SearchOpportunitiesOutput } from './adapters/searchOpportunities';
import { serperSearch, type SerpOutput } from './adapters/serper';
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

const opportunitiesInput = z.object({
  days: z.number().int().min(7).max(90).default(28),
  minImpressions: z.number().int().min(1).max(100_000).default(50),
  minPosition: z.number().min(1).max(100).default(8),
  maxPosition: z.number().min(1).max(100).default(20),
  website: z.string().max(253).optional(),
}).strict();

const searchOpportunitiesRead: CapabilityDefinition<z.infer<typeof opportunitiesInput>, SearchOpportunitiesOutput> = {
  id: 'search.opportunities.read',
  version: 1,
  title: 'Search opportunities',
  domain: 'search',
  kind: 'read',
  risk: 'read',
  approval: 'auto',
  provider: 'gsc',
  requiresResource: 'site',
  input: opportunitiesInput,
  cacheSeconds: 6 * 3600,
  toolDescription: "SEO opportunities from one company's own Search Console data (free): striking-distance queries (ranking 8-20 with real impressions), queries split between several of its own pages (cannibalization), top positions with poor click-through (title and description fixes), and pages losing clicks versus the previous period. Optional website limits it to one of the company's sites.",
  toolParameters: {
    days: { type: 'integer', description: 'Window in days (7-90, default 28)' },
    minImpressions: { type: 'integer', description: 'Ignore queries with fewer impressions in the window (default 50)' },
    minPosition: { type: 'number', description: 'Striking distance starts at this average position (default 8)' },
    maxPosition: { type: 'number', description: 'Striking distance ends at this average position (default 20)' },
    website: { type: 'string', description: "One of the company's websites, e.g. example.com (default: all of them)" },
  },
  async run(ctx, input) {
    if (input.minPosition > input.maxPosition) throw new CapabilityError('failed', 'minPosition must not be above maxPosition.');
    const output = await searchOpportunities(ctx, input, SEARCH_LAG_DAYS);
    return { output, summary: `${output.strikingDistance.length} striking-distance queries, ${output.competingPages.length} with competing pages, ${output.decliningPages.length} declining pages` };
  },
};

const serpInput = z.object({
  query: z.string().trim().min(2).max(200),
  country: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/).default('us'),
  language: z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[a-z]{2})?$/).default('en'),
  location: z.string().trim().max(120).optional(),
}).strict();

const searchResultsRead: CapabilityDefinition<z.infer<typeof serpInput>, SerpOutput> = {
  id: 'search.results.read',
  version: 1,
  title: 'Google results for a search',
  domain: 'search',
  kind: 'read',
  risk: 'read',
  approval: 'auto',
  provider: 'serper',
  input: serpInput,
  // Each search spends a paid credit; the same search within two weeks is answered from the receipt.
  cacheSeconds: 14 * 86_400,
  maxOutputBytes: 60_000,
  toolDescription: 'Live Google results for one search phrase (one paid Serper credit, reused for 14 days): the top 10 pages with titles and domains, People also ask questions, related searches, any answer box, and where the company ranks. Use it to see search intent and the format that wins (list, guide, comparison, product page) for a shortlisted keyword, not for broad keyword discovery.',
  toolParameters: {
    query: { type: 'string', description: 'The exact search phrase', required: true },
    country: { type: 'string', description: 'Two-letter country code (default us)' },
    language: { type: 'string', description: 'Language code (default en)' },
    location: { type: 'string', description: 'Optional city or region, e.g. "Las Vegas, Nevada, United States"' },
  },
  async run(ctx, input) {
    const output = await serperSearch(ctx, input);
    return { output, summary: `Top ${output.organic.length} results for "${input.query}"${output.companyPosition ? `; the company ranks #${output.companyPosition}` : '; the company is not in the top 10'}` };
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

const adRevenue: CapabilityDefinition<DaysInput, AdRevenueOutput> = {
  id: 'ads.revenue.read',
  version: 1,
  title: 'Ad revenue',
  domain: 'ads',
  kind: 'read',
  risk: 'read',
  approval: 'auto',
  provider: 'adsense',
  requiresResource: 'site',
  input: daysInput,
  cacheSeconds: 600,
  async run(ctx, input) {
    const output = await adsenseRevenue(ctx, defaultRange(input.days, ctx.now));
    return { output, summary: 'Ad earnings for ' + output.domain + ' over ' + input.days + ' days' };
  },
};

const adxRevenue: CapabilityDefinition<DaysInput, AdxOutput> = {
  id: 'ads.adx.revenue.read', version: 1, title: 'AdX revenue and performance',
  domain: 'ads', kind: 'read', risk: 'read', approval: 'auto',
  provider: 'admanager', requiresResource: ['network', 'site'], input: daysInput, cacheSeconds: 600,
  async run(ctx, input) {
    const output = await admanagerRevenue(ctx, defaultRange(input.days, ctx.now));
    return { output, summary: 'AdX performance for ' + output.domain + ' in ' + output.timeZone + ' over ' + input.days + ' days' };
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
  searchOpportunitiesRead,
  searchResultsRead,
  emailAudience,
  paymentsRevenue,
  adRevenue,
  adxRevenue,
  financeCash,
  seoOverview,
  seoProjectCreate,
] as CapabilityDefinition[];

export function getCapability(id: string, registry: CapabilityDefinition[] = CAPABILITIES): CapabilityDefinition | undefined {
  return registry.find((c) => c.id === id);
}
