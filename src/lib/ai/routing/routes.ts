/**
 * Named model routes. Every AI job asks for a route; each organization assigns a model to it.
 * Paid models plan and judge; Rogly (free, self-hosted) does the volume.
 */

export type RouteTier = 'paid' | 'free';

export interface RouteDefinition {
  key: string;
  label: string;
  description: string;
  /** Which kind of model this route is meant for; a hint for defaults and the admin UI. */
  preferredTier: RouteTier;
  /** Default Rogly model for free routes (matched against the free credential's catalog). */
  defaultFreeModel?: string;
  /** Existing AI Team binding to inherit when the route is not assigned yet. */
  inheritFrom?: { employee: 'marketing' | 'product' | 'support' | 'engineering' | 'researcher'; stage: 'planner' | 'worker' | 'reviewer' };
  /** When the free model fails or is unavailable, may this route escalate to its paid fallback? */
  paidFallbackAllowedByDefault: boolean;
}

export const ROGLY_MODELS = {
  general: 'google/gemma-4-12B-it-qat-w4a16-ct',
  code: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ',
  vision: 'Qwen/Qwen3-VL-8B-Thinking-FP8',
} as const;

export const ROUTES: RouteDefinition[] = [
  {
    key: 'assistant.plan',
    label: 'Ask · plan',
    description: 'Reads the question and a compact portfolio summary; decides what data to fetch and how to answer. One small call, no tools.',
    preferredTier: 'paid',
    inheritFrom: { employee: 'product', stage: 'planner' },
    paidFallbackAllowedByDefault: false,
  },
  {
    key: 'assistant.work',
    label: 'Ask · work',
    description: 'Turns the fetched data into the answer or draft. Carries the large inputs, so it runs on Rogly.',
    preferredTier: 'free',
    defaultFreeModel: ROGLY_MODELS.general,
    paidFallbackAllowedByDefault: true,
  },
  {
    key: 'assistant.review',
    label: 'Ask · review',
    description: 'Checks answers that recommend or take action, or whose numbers failed the automatic check.',
    preferredTier: 'paid',
    inheritFrom: { employee: 'product', stage: 'reviewer' },
    paidFallbackAllowedByDefault: false,
  },
  {
    key: 'research.work',
    label: 'Deep research',
    description: 'Multi-step web research: searches, reads, then searches again based on what it found. Runs the web tools itself, so it needs a model that is reliable at tool calls.',
    preferredTier: 'free',
    defaultFreeModel: ROGLY_MODELS.code,
    paidFallbackAllowedByDefault: false,
  },
  {
    key: 'ide.plan',
    label: 'IDE · plan',
    description: 'Plans code changes from a compact brief.',
    preferredTier: 'paid',
    inheritFrom: { employee: 'engineering', stage: 'planner' },
    paidFallbackAllowedByDefault: false,
  },
  {
    key: 'ide.work',
    label: 'IDE · explore & work',
    description: 'Reads the repository and does focused jobs one at a time.',
    preferredTier: 'free',
    defaultFreeModel: ROGLY_MODELS.code,
    paidFallbackAllowedByDefault: false,
  },
  {
    key: 'ide.review',
    label: 'IDE · review',
    description: 'Reviews code changes and evidence before anything is proposed for commit.',
    preferredTier: 'paid',
    inheritFrom: { employee: 'engineering', stage: 'reviewer' },
    paidFallbackAllowedByDefault: false,
  },
  {
    key: 'utility.text',
    label: 'Summaries & estimates',
    description: 'Recording summaries, hour estimates, voice/palette intent parsing.',
    preferredTier: 'free',
    defaultFreeModel: ROGLY_MODELS.general,
    paidFallbackAllowedByDefault: false,
  },
  {
    key: 'visual.inspect',
    label: 'Vision',
    description: 'Understanding screenshots and images.',
    preferredTier: 'free',
    defaultFreeModel: ROGLY_MODELS.vision,
    paidFallbackAllowedByDefault: false,
  },
];

export function getRoute(key: string): RouteDefinition | undefined {
  return ROUTES.find((r) => r.key === key);
}
