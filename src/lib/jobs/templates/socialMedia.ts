import type { JobDesign } from '../schema';

export function socialMediaDesign(platforms: string[]): JobDesign {
  const selected = platforms.filter((value) => value && value.toLowerCase() !== 'not established');
  return {
    skill: 'social_media', title: 'Social media drafts', category: 'marketing',
    instructions: `Create one timely social post draft using the approved Marketing Plan. Choose the best current content pillar and priority page. ${selected.length ? `Target only these approved platforms: ${selected.join(', ')}.` : 'Choose a platform only when the approved plan establishes one; otherwise explain the gap.'} Adapt format, voice, length, hook, and call to action to the platform. Do not publish.`,
    fields: [
      { key: 'platform', label: 'Platform', type: 'text', required: true, description: 'Approved social platform.' },
      { key: 'objective', label: 'Objective', type: 'text', required: true, description: 'Goal and funnel stage.' },
      { key: 'post_copy', label: 'Post copy', type: 'long_text', required: true, description: 'Ready-to-review platform-specific draft.' },
      { key: 'target_url', label: 'Target URL', type: 'url', required: true, description: 'Verified first-party page supported by the post.' },
      { key: 'creative_brief', label: 'Creative brief', type: 'long_text', required: true, description: 'Recommended visual/video concept and accessibility notes.' },
      { key: 'hashtags', label: 'Hashtags', type: 'list', required: false, description: 'Relevant restrained tags when appropriate.' },
      { key: 'reason', label: 'Why this post', type: 'long_text', required: true, description: 'Marketing-plan evidence supporting this choice.' },
    ],
    sourcePolicy: 'Cite the first-party target page and any timely source used. Follow the approved Marketing Plan.',
    delivery: { method: 'nucleas', detail: 'Saved as a draft for approval. No social account is posted to automatically.', setupSteps: [] },
    schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' }, recordsPerRun: 1,
    safeguards: ['Draft only; never publish without a separately enabled, approval-gated publishing workflow.', 'Do not invent product claims, events, offers, or statistics.', 'Use only approved platforms and messaging.'],
    recommendedCompletion: 'review', findings: ['Social publishing remains disabled until an account is connected and explicit publishing approval is added.'], questions: [],
  };
}
