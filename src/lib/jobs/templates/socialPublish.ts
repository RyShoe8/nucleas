import type { JobDesign } from '../schema';

/** A publishing job: every hour, each new item becomes one post per chosen platform, in the company's approved Voice. */
export function socialPublishDesign(input: { noun: string; sourceLabel: string; platforms: string[]; /** Evergreen rotation: one existing item every N days, oldest first. */ everyDays?: number }): JobDesign {
  return {
    skill: 'social_publish',
    title: input.everyDays ? `Post one ${input.noun} every ${input.everyDays % 7 === 0 ? (input.everyDays === 7 ? 'week' : `${input.everyDays / 7} weeks`) : `${input.everyDays} days`}` : `Post new ${input.noun}s to social`,
    category: 'marketing',
    instructions: `${input.sourceLabel}. For each ${input.everyDays ? `${input.noun} in the rotation` : `new ${input.noun}`}, write one post per platform (${input.platforms.join(', ')}) in the company's approved Voice, shaped like the example posts, using only facts from the ${input.noun}'s own page. Platforms set to automatic are posted to directly; the others become ready-to-post cards for the team.`,
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

/**
 * An admin publishing job (same engine, skill 'social_publish'): every hour, each new item becomes one record
 * in the company's own admin, filled through its form with the captured admin session.
 */
export function adminPublishDesign(input: { noun: string; sourceLabel: string; host: string }): JobDesign {
  const social = socialPublishDesign({ noun: input.noun, sourceLabel: input.sourceLabel, platforms: [] });
  return {
    ...social,
    title: `Add new ${input.noun}s to the ${input.host} admin`,
    instructions: `${input.sourceLabel}. For each new ${input.noun}, fill the ${input.host} admin form with values taken only from the ${input.noun} itself, save it, and confirm it appears on the list page. On automatic, Nucleas saves it; on manual, the team gets a ready-to-add card.`,
    fields: [
      { key: 'platform', label: 'Destination', type: 'text', required: true, description: '' },
      { key: 'post_copy', label: 'Values', type: 'long_text', required: true, description: '' },
      { key: 'status', label: 'Status', type: 'text', required: false, description: '' },
    ],
    delivery: { method: 'browser', detail: `Saved through the ${input.host} admin form with the company's captured admin session.`, setupSteps: [] },
    safeguards: [
      `Only ${input.noun}s that arrive after the job is switched on are added.`,
      `The same ${input.noun} sent again within two weeks is added once.`,
      'A required field the facts do not give stops the automatic save; the team gets a card instead.',
      'If the form changes, Nucleas learns it again once; anything else that fails becomes a card.',
    ],
  };
}
