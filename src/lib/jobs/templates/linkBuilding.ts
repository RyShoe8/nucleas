import { z } from 'zod';
import type { JobDesign } from '../schema';

export const linkBuildingConfigSchema = z.object({
  projectId: z.string().min(1),
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

export const LINK_DISCOVERY_FOCUS = 'DIRECTORY AND FORUM FOCUS. Start discovery with niche directories and relevant forums or Q&A communities serving the approved Marketing Plan audience. Search for real existing listings, categories and discussions, then follow their actual submission or contribution links; never invent a submission URL. For directories, verify that the relevant category accepts this kind of property (for example a community, resource or tool, not only operators). For forums, open the specific discussion or suitable contribution category and its posting rules, verify that useful contributions and relevant links are allowed, and draft a helpful context-specific response rather than an advertisement. Record account, moderation and self-promotion requirements; do not recommend a forum when permission to contribute a link cannot be established. Nofollow links are acceptable when the audience fit is strong. Search both directories and forums before considering other free self-service sources, and explain why any fallback was needed. Keep all existing verification, deduplication and review safeguards.';
export const DIRECTORY_QUEUE_POLICY = 'DIRECTORY QUEUE POLICY v3. Work through the supplied persistent directory leads first instead of restarting with broad web searches. A legitimate general startup, business, website or product directory qualifies when this company is eligible for a suitable category and its content is allowed; the whole directory need not cater exclusively to the niche. Label this as a foundational listing rather than claiming targeted referral traffic. Niche directories and genuinely relevant forum contributions remain preferred when available. Do not mistake a game marketplace or a creator-upload platform such as itch.io for a business directory: a signup button or game inventory does not prove this company may place a public external link. Require the real submission steps, a public website-link field or permitted linked contribution, category/product eligibility and a genuinely free option. Do not invent a game, upload third-party content or misrepresent ownership. Check gambling/content restrictions for gambling-related properties. Historical lists, authority scores and free labels are discovery hints only; reopen the destination and verify current rules. Do not spend calls hunting speculative authority or analytics: use existing company facts and the approved plan for a concrete foundational-listing rationale; report unavailable authority as unknown. Never fabricate low authority, a new launch, missing backlinks or a traffic decline. Public submission documentation explicitly confirming a website listing/link is sufficient when the final form requires a free account; do not demand access to an authenticated form before recommending it. A signup button alone is insufficient. Search the directory for an existing company listing and report the search and its limitations; do not demand impossible proof of absence across the entire web.';

/** Apply the same discovery priority to saved jobs without changing their settings. */
export function withLinkDiscoveryFocus(design: JobDesign): JobDesign {
  if (design.skill !== 'link_building') return design;
  const instructions = design.instructions.replace(/DIRECTORY QUEUE POLICY v\d+\.[^\n]*/g, '').trim()
    .replace(/Begin by diagnosing what would create the most strategic value now\.[\s\S]*?state the limitation\./, 'Prioritize one usable directory listing or helpful forum contribution consistent with the approved plan. An appropriate foundational listing is a valid strategy on its own; do not require a fresh authority, ranking or competitor-gap diagnosis to recommend it. Never invent metrics, missing backlinks or business history.')
    .replace('Call list_companies first to see which data providers are connected. Use company_metrics and all relevant connected search, analytics, and SEO read tools before public research.', 'Use the supplied company context and approved plan first. Consult connected metrics when making a specific performance or competitor claim, but a foundational listing does not require repeating analytics discovery before every attempt. Spend the run verifying eligibility and the actual free link-placement path.')
    .replace('Treat direct audience and topical overlap as mandatory, not a bonus. Reject broad directories whose actual inventory, visitors, or category structure does not directly serve the approved Marketing Plan audience and topics. A site being indexable or authoritative is never enough by itself.', 'Require real eligibility and an appropriate category. Broad legitimate directories are allowed for foundational listings; authority alone never proves eligibility.')
    .replace('Use multiple independent public signals for estimated authority.', 'Keep authority unknown unless supported; never spend the research budget trying to manufacture an estimate.');
  return { ...design, instructions: [instructions, instructions.includes(LINK_DISCOVERY_FOCUS) ? '' : LINK_DISCOVERY_FOCUS, instructions.includes(DIRECTORY_QUEUE_POLICY) ? '' : DIRECTORY_QUEUE_POLICY].filter(Boolean).join('\n\n'), fields: design.fields.map(field => field.key === 'relevance_score' ? { ...field, description: '0–100 real eligibility and category/context fit. A suitable category in a legitimate general directory can qualify; 75+ required.' } : field.key === 'relevance_evidence' ? { ...field, description: 'Prove the company is eligible for this category or contribution, and quote the actual submission page.' } : field), safeguards: design.safeguards.map(rule => rule === 'Reject anything below 75/100 direct relevance to the approved Marketing Plan.' ? 'Require 75/100 eligibility and category/context fit; appropriate general directories qualify for foundational listings.' : rule) };
}

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
      'Begin by diagnosing what would create the most strategic value now. Consider weak domain or homepage authority, newly launched pages, ranking or traffic declines, high-impression near-ranking pages, commercially important pages, topic-authority gaps, and competitor backlink gaps. These are candidate diagnoses, not a checklist: choose the single strongest strategy the available evidence actually supports. Never claim a ranking decline, traffic decline, or competitor gap without exact supporting data. If those signals are unavailable, choose a different, provable rationale and state the limitation.',
      'Call list_companies first to see which data providers are connected. Use company_metrics and all relevant connected search, analytics, and SEO read tools before public research. If no SEO or keyword provider is available, compensate with free public evidence: search for indexed pages, rankings, competitors, competitor citations/backlinks, niche directories, resource pages, and comparable listings. Use web_search and web_fetch first, then browser_navigate through the Playwright worker for JavaScript-rendered or thin pages and free public tools. Never bypass a login, CAPTCHA, rate limit, robots restriction, or site terms. Clearly label authority as an estimate unless a connected provider returned the metric directly.',
      LINK_DISCOVERY_FOCUS,
      DIRECTORY_QUEUE_POLICY,
      'Exclude paid placements, link exchanges, PBNs, mass-submission or spam directories, irrelevant comments, fake identities, artificial community participation, outreach-only opportunities, journalist/PR work, and launch platforms that require an existing following. Verify the destination and submission path still exist, no payment is required, the property is not already listed, and the recommendation has not appeared in earlier runs.',
      'The opportunity URL must be a page you opened with a tool during this run and that loaded. Never guess an address: not a directory path, a topic or category page, or a submission form you merely expect to exist. If you cannot open it, do not recommend it. Nucleas checks every recommended page and rejects ones that return not found.',
      'Provide ready-to-use submission text when the opportunity supports it. Do not submit, create an account, post, or contact anyone; this phase recommends only.',
      config.exclusions ? `Property-specific exclusions: ${config.exclusions}` : '',
    ].filter(Boolean).join('\n\n'),
    fields: [
      { key: 'strategic_reason', label: 'Why now', type: 'long_text', required: true, description: 'The diagnosed weakness or opportunity and evidence behind this priority.' },
      { key: 'strategy_evidence', label: 'Strategy evidence', type: 'long_text', required: true, description: 'Specific metric, date range, page observation, named competitor, or other sourced fact proving the chosen diagnosis. Never use a generic claim.' },
      { key: 'opportunity_url', label: 'Opportunity', type: 'url', required: true, description: 'Exact public page where the listing, profile, resource, or contribution can be submitted.' },
      { key: 'opportunity_type', label: 'Type', type: 'text', required: true, description: 'Directory, resource page, profile, forum, Q&A, competitor gap, or another legitimate self-service type.' },
      { key: 'relevance_score', label: 'Relevance score', type: 'number', required: true, description: '0–100 direct relevance to the approved audience, topics, and target page; only 75+ qualifies.' },
      { key: 'relevance_evidence', label: 'Relevance evidence', type: 'long_text', required: true, description: 'Concrete evidence of audience and topical overlap from the opportunity page.' },
      { key: 'estimated_authority', label: 'Estimated authority', type: 'text', required: true, description: 'A clearly labeled estimate/range, or an exact named metric only when returned by a connected provider.' },
      { key: 'authority_basis', label: 'Authority evidence', type: 'long_text', required: true, description: 'Signals and sources used for the estimate; never present an invented Ahrefs DR.' },
      { key: 'target_keywords', label: 'Target keywords', type: 'list', required: true, description: 'Keywords or topic cluster this link should support.' },
      { key: 'target_url', label: 'Target page', type: 'url', required: true, description: 'The property URL that should receive the link.' },
      { key: 'anchor_text', label: 'Link text', type: 'text', required: true, description: 'Natural suggested anchor or profile link text, avoiding over-optimization.' },
      { key: 'submission_copy', label: 'Submission copy', type: 'long_text', required: true, description: 'Useful, truthful, ready-to-use listing, profile, forum, or resource submission text.' },
      { key: 'requirements', label: 'Requirements', type: 'long_text', required: true, description: 'Account, moderation, fields, assets, and exact self-service submission steps. For forums, cite posting and self-promotion rules establishing that the proposed contribution and link are allowed.' },
      { key: 'link_attribute', label: 'Link attribute', type: 'text', required: true, description: 'Follow, nofollow, sponsored, or unknown, with uncertainty preserved.' },
      { key: 'competitor_evidence', label: 'Competitor evidence', type: 'long_text', required: false, description: 'A specifically named real competitor and its exact listing/backlink URL when found. Leave empty rather than using a placeholder.' },
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
      'Reject anything below 75/100 direct relevance to the approved Marketing Plan.',
      'Never use placeholders such as “Competitor X.” If competitor evidence is unavailable, leave it empty and do not claim a competitor gap.',
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
