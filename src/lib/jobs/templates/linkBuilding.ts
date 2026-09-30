import { z } from 'zod';
import type { JobDesign } from '../schema';

export const linkBuildingConfigSchema = z.object({
  schedule: z.object({
    kind: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
    timezone: z.string().min(1).max(100).default('UTC'),
    weekday: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
  }),
  recordsPerRun: z.number().int().min(1).max(10).default(1),
  country: z.string().trim().min(2).max(80).default('United States'),
  language: z.string().trim().min(2).max(80).default('English'),
  exclusions: z.string().trim().max(1000).default(''),
});

export type LinkBuildingConfig = z.infer<typeof linkBuildingConfigSchema>;

export function linkBuildingDesign(config: LinkBuildingConfig): JobDesign {
  const schedule = {
    ...config.schedule,
    ...(config.schedule.kind === 'weekly' ? { weekday: config.schedule.weekday ?? 1 } : {}),
    ...(config.schedule.kind === 'monthly' ? { dayOfMonth: config.schedule.dayOfMonth ?? 1 } : {}),
  };
  return {
    skill: 'link_building',
    title: 'Link building opportunities',
    category: 'marketing',
    instructions: [
      `Find the ${config.recordsPerRun === 1 ? 'single best' : `${config.recordsPerRun} best`} legitimate, free, self-service link-building ${config.recordsPerRun === 1 ? 'opportunity' : 'opportunities'} for this property in ${config.country}, using ${config.language}.`,
      'Begin by diagnosing what would create the most strategic value now. Use connected search/SEO/analytics data to detect weak domain or homepage authority, newly launched pages, ranking or traffic declines, high-impression near-ranking pages, commercially important pages, topic-authority gaps, and competitor backlink gaps. Select the target page, keywords, tactic, and natural anchor from that evidence; do not rotate mechanically through tactics.',
      'Call list_companies first to see which data providers are connected. Use company_metrics and all relevant connected search, analytics, and SEO read tools before public research. If no SEO or keyword provider is available, compensate with free public evidence: search for indexed pages, rankings, competitors, competitor citations/backlinks, niche directories, resource pages, and comparable listings. Use web_search and web_fetch first, then browser_navigate through the Playwright worker for JavaScript-rendered or thin pages and free public tools. Never bypass a login, CAPTCHA, rate limit, robots restriction, or site terms. Clearly label authority as an estimate unless a connected provider returned the metric directly.',
      'Prioritize relevant niche/business/software/local directories, public resource databases, legitimate industry profiles, partner or technology directories available to the property, useful forum or Q&A contributions, competitor-linked self-service listings, and broken/outdated resources with a direct submission mechanism.',
      'Exclude paid placements, link exchanges, PBNs, mass-submission or spam directories, irrelevant comments, fake identities, artificial community participation, outreach-only opportunities, journalist/PR work, and launch platforms that require an existing following. Verify the destination and submission path still exist, no payment is required, the property is not already listed, and the recommendation has not appeared in earlier runs.',
      'Provide ready-to-use submission text when the opportunity supports it. Do not submit, create an account, post, or contact anyone; this phase recommends only.',
      config.exclusions ? `Property-specific exclusions: ${config.exclusions}` : '',
    ].filter(Boolean).join('\n\n'),
    fields: [
      { key: 'strategic_reason', label: 'Why now', type: 'long_text', required: true, description: 'The diagnosed weakness or opportunity and evidence behind this priority.' },
      { key: 'opportunity_url', label: 'Opportunity', type: 'url', required: true, description: 'Exact public page where the listing, profile, resource, or contribution can be submitted.' },
      { key: 'opportunity_type', label: 'Type', type: 'text', required: true, description: 'Directory, resource page, profile, forum, Q&A, competitor gap, or another legitimate self-service type.' },
      { key: 'estimated_authority', label: 'Estimated authority', type: 'text', required: true, description: 'A clearly labeled estimate/range, or an exact named metric only when returned by a connected provider.' },
      { key: 'authority_basis', label: 'Authority evidence', type: 'long_text', required: true, description: 'Signals and sources used for the estimate; never present an invented Ahrefs DR.' },
      { key: 'target_keywords', label: 'Target keywords', type: 'list', required: true, description: 'Keywords or topic cluster this link should support.' },
      { key: 'target_url', label: 'Target page', type: 'url', required: true, description: 'The property URL that should receive the link.' },
      { key: 'anchor_text', label: 'Link text', type: 'text', required: true, description: 'Natural suggested anchor or profile link text, avoiding over-optimization.' },
      { key: 'submission_copy', label: 'Submission copy', type: 'long_text', required: true, description: 'Useful, truthful, ready-to-use listing, profile, forum, or resource submission text.' },
      { key: 'requirements', label: 'Requirements', type: 'long_text', required: true, description: 'Account, moderation, fields, assets, and exact self-service submission steps.' },
      { key: 'link_attribute', label: 'Link attribute', type: 'text', required: true, description: 'Follow, nofollow, sponsored, or unknown, with uncertainty preserved.' },
      { key: 'competitor_evidence', label: 'Competitor evidence', type: 'long_text', required: false, description: 'Comparable competitor listing or backlink when found.' },
      { key: 'quality_risk', label: 'Quality and risk', type: 'long_text', required: true, description: 'Relevance, spam indicators, moderation, and reasons the opportunity passed the safeguards.' },
      { key: 'confidence', label: 'Confidence', type: 'text', required: true, description: 'High, medium, or low with a short reason.' },
      { key: 'next_action', label: 'Next action', type: 'long_text', required: true, description: 'The next concrete action a person should take.' },
    ],
    sourcePolicy: 'Cite the opportunity/submission page, evidence for the target-page strategy, authority evidence, and competitor evidence. Prefer connected first-party data and primary pages. Use multiple independent public signals for estimated authority.',
    delivery: { method: 'nucleas', detail: 'A sourced recommendation brief kept in Nucleas for review. No external submission is made.', setupSteps: [] },
    schedule,
    recordsPerRun: config.recordsPerRun,
    safeguards: [
      'Recommendations only: never submit, post, create an account, or contact anyone.',
      'Only free placements; reject paid links, exchanges, PBNs, and schemes intended to manipulate rankings.',
      'Forum and Q&A opportunities must support a genuinely useful, context-specific response.',
      'Never call an authority estimate Ahrefs DR unless Ahrefs returned that value.',
      'Do not repeat previously recommended, rejected, submitted, or live opportunities.',
    ],
    recommendedCompletion: 'review',
    findings: [
      'The skill chooses its strategy from current property performance rather than requiring manually supplied keywords or target pages.',
      'Connected SEO/search/analytics data is preferred; public search and Playwright-rendered free tools provide a documented fallback.',
      'This phase produces recommendations only. Submission and creation will be added after recommendation quality is proven.',
    ],
    questions: [],
  };
}
