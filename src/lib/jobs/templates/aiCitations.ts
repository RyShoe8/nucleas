import type { JobDesign } from '../schema';

export function aiCitationDesign(): JobDesign {
  return {
    skill: 'ai_citations', title: 'AI citation opportunities', category: 'marketing',
    instructions: 'Use the approved Marketing Plan and current public evidence to identify the single highest-value, legitimate opportunity to improve the company’s visibility and citations in AI-generated answers. Focus on factual completeness, entity consistency, source-worthy first-party content, and credible third-party corroboration. Do not submit or publish anything.',
    fields: [
      { key: 'target_question', label: 'Target question', type: 'text', required: true, description: 'The user question or intent this opportunity supports.' },
      { key: 'current_evidence', label: 'Current evidence', type: 'long_text', required: true, description: 'What current sources and AI answers establish.' },
      { key: 'recommended_action', label: 'Recommended action', type: 'long_text', required: true, description: 'Specific content/entity/corroboration improvement.' },
      { key: 'target_url', label: 'Target page', type: 'url', required: true, description: 'Verified page to improve or support.' },
      { key: 'source_target', label: 'Citation source target', type: 'url', required: false, description: 'Credible external source/opportunity when applicable.' },
      { key: 'expected_value', label: 'Expected value', type: 'long_text', required: true, description: 'Why this should improve citation eligibility.' },
    ],
    sourcePolicy: 'Cite the verified target page, observed AI/search evidence, and any recommended external source.',
    delivery: { method: 'nucleas', detail: 'A sourced recommendation saved for review; no external change is made.', setupSteps: [] },
    schedule: { kind: 'daily', time: '10:00', timezone: 'UTC' }, recordsPerRun: 1,
    safeguards: ['Never fabricate AI-answer observations or citations.', 'Never submit, publish, or contact a third party.', 'Recommendations must follow the approved Marketing Plan.'],
    recommendedCompletion: 'review', findings: [], questions: [],
  };
}
