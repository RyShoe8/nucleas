import { z } from 'zod';
import type { JobDesign } from '../schema';

export const marketingPlanConfigSchema = z.object({ companyName: z.string().trim().min(1).max(200) });
export type MarketingPlanConfig = z.infer<typeof marketingPlanConfigSchema>;

export function marketingPlanDesign(config: MarketingPlanConfig): JobDesign {
  return {
    skill: 'marketing_plan',
    title: `Marketing plan · ${config.companyName}`,
    category: 'marketing',
    instructions: [
      `Create a complete, durable marketing plan for “${config.companyName}”.`,
      'Treat the completed Company Overview and its archived pages as the factual source of truth. Use connected analytics, search, revenue, customer, repository, and integration evidence when available. Never infer the business, audience, geography, competitors, pages, or performance from the brand name.',
      'Build one coordinated strategy covering SEO, AI-answer visibility and citations, and social media. Define shared goals, positioning, messaging pillars, audiences, exclusions, priority pages, channel roles, measurable outcomes, and the evidence behind every material claim.',
      'The SEO strategy must identify defensible topic clusters and verified priority pages. The AI-citation strategy must identify the questions the company should be cited for, the entity facts that need consistency, and credible source types worth earning. The social strategy must recommend only platforms that fit the evidenced audience and explain content pillars and cadence.',
      'Recommend recurring work that can be converted into separate jobs after a manager approves this plan. Do not publish, submit, create accounts, or change external systems.',
      'Cite only exact verified first-party URLs. Name competitors only with supporting external URLs. Use “Not established” instead of guessing when evidence is missing.',
    ].join('\n\n'),
    fields: [
      { key: 'summary', label: 'Company and offering', type: 'long_text', required: true, description: 'Grounded description of the company, offering, and market.' },
      { key: 'audience', label: 'Target audience', type: 'long_text', required: true, description: 'Who the company serves, their intent, and explicit exclusions.' },
      { key: 'goals', label: 'Marketing goals', type: 'list', required: true, description: 'Prioritized and measurable business/marketing outcomes.' },
      { key: 'positioning', label: 'Positioning', type: 'long_text', required: true, description: 'Differentiation, promise, and tone.' },
      { key: 'messaging_pillars', label: 'Messaging pillars', type: 'list', required: true, description: 'Themes every channel should reinforce.' },
      { key: 'seo_strategy', label: 'SEO strategy', type: 'long_text', required: true, description: 'Topic, content, technical, internal-linking, and authority priorities.' },
      { key: 'primary_topics', label: 'Primary topics', type: 'list', required: true, description: 'Grounded keyword and topic clusters.' },
      { key: 'competitors', label: 'Search competitors', type: 'list', required: true, description: 'Verified competing domains/products, or Not established.' },
      { key: 'excluded_topics', label: 'Excluded topics', type: 'list', required: true, description: 'Misleading adjacent topics and audiences.' },
      { key: 'geographic_targets', label: 'Geographic targets', type: 'list', required: true, description: 'Evidence-backed regions, or Not established.' },
      { key: 'priority_pages', label: 'Priority pages', type: 'long_text', required: true, description: 'JSON array of {url, purpose, keywords[]} using only verified pages.' },
      { key: 'ai_citation_strategy', label: 'AI citation strategy', type: 'long_text', required: true, description: 'How the company should become a reliable source in AI answers.' },
      { key: 'ai_target_questions', label: 'AI target questions', type: 'list', required: true, description: 'Questions and intents for which the company should be cited.' },
      { key: 'ai_source_targets', label: 'AI source targets', type: 'list', required: true, description: 'Credible source categories or properties where corroboration should be earned.' },
      { key: 'social_strategy', label: 'Social strategy', type: 'long_text', required: true, description: 'Channel roles, voice, formats, distribution, and engagement approach.' },
      { key: 'social_platforms', label: 'Social platforms', type: 'list', required: true, description: 'Only platforms justified by the audience and offering.' },
      { key: 'social_content_pillars', label: 'Social content pillars', type: 'list', required: true, description: 'Repeatable themes for social drafts.' },
      { key: 'social_cadence', label: 'Social cadence', type: 'long_text', required: true, description: 'Recommended frequency and mix by platform.' },
      { key: 'kpis', label: 'KPIs', type: 'list', required: true, description: 'Measurements connecting channel work to goals.' },
      { key: 'notes', label: 'Risks and evidence gaps', type: 'long_text', required: false, description: 'Uncertainties, constraints, and follow-up research.' },
    ],
    sourcePolicy: 'Cite at least two exact archived first-party URLs. Cite connected data for performance claims and one external source per named competitor. Fabricated or merely plausible URLs fail the run.',
    delivery: { method: 'nucleas', detail: 'Saved as an editable company Marketing Plan. Approval creates separate proposed execution jobs; nothing publishes automatically.', setupSteps: [] },
    schedule: { kind: 'once' },
    recordsPerRun: 1,
    safeguards: ['Strategy only: never publish or alter external systems.', 'Use the Company Overview as the source of truth.', 'Unsupported facts must be marked Not established.', 'Generated execution jobs require separate approval.'],
    recommendedCompletion: 'review',
    findings: ['The approved plan becomes shared context for SEO, AI-citation, social, and future marketing work.'],
    questions: [],
  };
}
