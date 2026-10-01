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
      'Research the property, its actual audience, offering, indexed pages, search landscape, competitors, and connected analytics/search data. Use repository evidence when available. Distinguish facts from recommendations.',
      'The brief must be specific enough to reject irrelevant marketing opportunities. Topics, audiences, competitors, exclusions, and priority pages must describe this property—not a broad industry guess.',
      'Recommend a small set of priority pages and explain each page’s purpose and keyword cluster. Include explicit excluded topics or audiences that appear superficially related but should not drive SEO work.',
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
    sourcePolicy: 'Cite first-party pages, connected search/analytics data, repository evidence, and primary competitor pages. Do not invent traffic, rankings, or authority metrics.',
    delivery: { method: 'nucleas', detail: 'Saved as an editable draft in Nucleas, then used only after a manager approves it.', setupSteps: [] },
    schedule: { kind: 'once' },
    recordsPerRun: 1,
    safeguards: ['Produce exactly one brief record.', 'Do not make external changes.', 'Flag uncertain claims and missing data.', 'Priority pages must belong to the project property.'],
    recommendedCompletion: 'review',
    findings: ['The approved brief becomes required context for SEO-focused marketing skills, including link building.'],
    questions: [],
  };
}
