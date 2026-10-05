import { z } from 'zod';
import type { JobDesign } from '../schema';

export const seoBriefConfigSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().trim().min(1).max(200),
});
export type SeoBriefConfig = z.infer<typeof seoBriefConfigSchema>;

export function seoBriefDesign(config: SeoBriefConfig): JobDesign {
  return {
    skill: 'seo_brief',
    title: `SEO brief · ${config.projectName}`,
    category: 'marketing',
    instructions: [
      `Create a durable SEO strategy brief for the project “${config.projectName}”.`,
      'Establish the property identity before making any SEO recommendation. Read the verified project facts supplied by Nucleas, inspect the selected project repository with repo_tree/repo_read, and fetch the live first-party site. Do not infer the market, audience, age group, use case, or business model from the brand name or domain name.',
      'Use the completed Company Overview and its archived pages as the source of truth for the property, its actual audience, offering, and indexed pages. Supplement it with repository and connected analytics/search evidence. Distinguish sourced facts from recommendations. Every statement about the offering and audience must be directly supported by first-party evidence.',
      'The brief must be specific enough to reject irrelevant marketing opportunities. Topics, audiences, competitors, exclusions, and priority pages must describe this property—not a broad industry guess.',
      'Recommend only priority pages listed in the supplied verified-page inventory. Never construct a plausible URL. Use absolute first-party URLs, explain each page’s purpose and keyword cluster, and include explicit excluded topics or audiences that appear superficially related but should not drive SEO work.',
      'Name a competitor only when a source URL supports the competitive relationship. Do not invent competitor brands. Do not claim a global, international, national, or local geographic target unless first-party or connected data says so; use “Not established” when it cannot be proven.',
      'If the repository or live site cannot establish the property identity, do not guess. Put the uncertainty in gaps and return no strategy record.',
    ].join('\n\n'),
    fields: [
      { key: 'summary', label: 'Property and offering', type: 'long_text', required: true, description: 'What the property is, offers, and should be known for.' },
      { key: 'audience', label: 'Target audience', type: 'long_text', required: true, description: 'Who it serves, their intent, and who it does not serve.' },
      { key: 'goals', label: 'SEO goals', type: 'list', required: true, description: 'Prioritized measurable search goals.' },
      { key: 'primary_topics', label: 'Primary topics', type: 'list', required: true, description: 'Core keyword/topic clusters.' },
      { key: 'competitors', label: 'Search competitors', type: 'list', required: true, description: 'Relevant competing domains or products.' },
      { key: 'excluded_topics', label: 'Excluded topics', type: 'list', required: true, description: 'Misleading or irrelevant adjacent topics, audiences, and industries.' },
      { key: 'geographic_targets', label: 'Geographic targets', type: 'list', required: true, description: 'Countries, regions, or local areas that matter.' },
      { key: 'positioning', label: 'Search positioning', type: 'long_text', required: true, description: 'Differentiation and tone that SEO work should preserve.' },
      { key: 'priority_pages', label: 'Priority pages', type: 'long_text', required: true, description: 'JSON array of {url, purpose, keywords[]} for pages SEO work should support.' },
      { key: 'notes', label: 'Strategy notes', type: 'long_text', required: false, description: 'Risks, evidence gaps, and follow-up recommendations.' },
    ],
    sourcePolicy: 'Every record must cite at least two exact first-party URLs from the verified Company Overview page inventory. When a repository is connected, also cite exact GitHub files used. Cite connected search/analytics data and an external source for every named competitor. Empty, fabricated, redirected, or merely plausible URLs fail the run. Do not invent traffic, rankings, authority metrics, pages, audiences, competitors, or geographic scope.',
    delivery: { method: 'nucleas', detail: 'Saved as an editable draft in Nucleas, then used only after a manager approves it.', setupSteps: [] },
    schedule: { kind: 'once' },
    recordsPerRun: 1,
    safeguards: ['Produce exactly one brief record only after the property identity is proven.', 'Do not make external changes.', 'Flag uncertainty instead of filling evidence gaps with assumptions.', 'Priority pages must be absolute, verified URLs belonging to the selected property.', 'Never infer that a site targets children, education, healthcare, finance, or another regulated/sensitive audience from its name.'],
    recommendedCompletion: 'review',
    findings: ['The approved brief becomes required context for SEO-focused marketing skills, including link building.'],
    questions: [],
  };
}
