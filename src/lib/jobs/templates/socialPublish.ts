import type { JobDesign } from '../schema';

/** A publishing job: every hour, each new item becomes one post per chosen platform, in the company's approved Voice. */
export function socialPublishDesign(input: { noun: string; sourceLabel: string; platforms: string[] }): JobDesign {
  return {
    skill: 'social_publish',
    title: `Post new ${input.noun}s to social`,
    category: 'marketing',
    instructions: `${input.sourceLabel}. For each new ${input.noun}, write one post per platform (${input.platforms.join(', ')}) in the company's approved Voice, shaped like the example posts, using only facts from the ${input.noun}'s own page. Platforms set to automatic are posted to directly; the others become ready-to-post cards for the team.`,
    fields: [
      { key: 'platform', label: 'Platform', type: 'text', required: true, description: '' },
      { key: 'post_title', label: 'Title', type: 'text', required: false, description: 'Reddit only.' },
      { key: 'post_copy', label: 'Post', type: 'long_text', required: true, description: '' },
      { key: 'target_url', label: 'Link', type: 'url', required: false, description: '' },
      { key: 'status', label: 'Status', type: 'text', required: false, description: '' },
      { key: 'posted_url', label: 'Live post', type: 'url', required: false, description: '' },
    ],
    sourcePolicy: `Only facts from the ${input.noun}'s own page.`,
    delivery: { method: 'integration', detail: 'Posted through the connected accounts, or prepared as ready-to-post cards.', setupSteps: [] },
    schedule: { kind: 'hourly' },
    recordsPerRun: 1,
    safeguards: [
      `Only ${input.noun}s that appear after the job is switched on are posted.`,
      'Many new items at once are treated as a site change and not posted.',
      'An automatic post that fails becomes a ready-to-post card.',
    ],
    recommendedCompletion: 'automatic',
    findings: [],
    questions: [],
  };
}
