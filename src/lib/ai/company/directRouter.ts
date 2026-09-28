import 'server-only';
import { randomUUID } from 'crypto';
import mongoose, { Types } from 'mongoose';
import { invokeModel, type GatewayConfiguration } from '@nucleas/ai-core/gateway';
import type { ModelRequest } from '@nucleas/ai-contracts';
import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';
import { isFreeCredential } from '@/lib/ai/rolePipeline/modelMeta';
import { holdDispatchLock, releaseDispatchLock, waitForDispatchLock } from '@/lib/ai/control/dispatchLock';
import { AiModelCheck } from '@/lib/ai/engine/checkResults';
import { extractJson } from '@/lib/ai/json';

/**
 * Direct mode with a free model: the model first sorts the request (forced JSON), then Nucleas
 * sends it down the matching process itself (plan a code change, design a job, or answer with
 * company tools). Small models reliably classify; they are less reliable at choosing among many
 * tools, so the choice that matters most is made this way.
 */

export const DIRECT_ROUTES = ['answer', 'code_change', 'job'] as const;
export type DirectRoute = (typeof DIRECT_ROUTES)[number];

export interface RouteDecision {
  route: DirectRoute;
  /** Company name exactly as listed, or null when none applies. */
  company: string | null;
  /** The request restated to stand alone (follow-ups resolved against the conversation). */
  request: string;
}

type Turn = { role: 'user' | 'assistant' | 'status'; text: string };

export function routerPrompt(companies: string[], codeCompanies: string[]): string {
  return [
    'You sort requests sent to Nucleas, the operating system for a group of companies. You do not answer them.',
    'answer: a question about the companies, their numbers or their work that can be answered now, or anything conversational.',
    'code_change: a change to a website or app (fix, remove, add or edit something on a page or in the code). Only these companies have code connected: ' +
      (codeCompanies.length ? codeCompanies.join(', ') : 'none') +
      '.',
    'job: non-code work to carry out once or on a repeat (research, collecting details into a catalog, outreach such as earning backlinks, content).',
    `company: which company the request is about, exactly as written in this list, or "none": ${companies.join(', ') || 'none'}.`,
    'request: the request restated in full so it stands alone. If the latest message is a follow-up ("yes, do that", "the second one"), use the conversation to spell out what is meant. Keep every page, URL, name and detail.',
    'Reply with JSON only: {"route": "...", "company": "...", "request": "..."}.',
  ].join('\n');
}

export function routeSchema(companies: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      route: { type: 'string', enum: [...DIRECT_ROUTES] },
      company: { type: 'string', enum: [...companies, 'none'] },
      request: { type: 'string' },
    },
    required: ['route', 'company', 'request'],
    additionalProperties: false,
  };
}

/** Reads the model's decision; null when it is not a usable one. */
export function parseDecision(text: string, companies: string[], fallbackRequest: string): RouteDecision | null {
  const parsed = extractJson(text) as { route?: unknown; company?: unknown; request?: unknown } | null;
  if (!parsed || !(DIRECT_ROUTES as readonly string[]).includes(String(parsed.route))) return null;
  const named = typeof parsed.company === 'string' ? companies.find((c) => c.toLowerCase() === parsed.company!.toString().trim().toLowerCase()) : undefined;
  const request = typeof parsed.request === 'string' && parsed.request.trim().length >= 10 ? parsed.request.trim().slice(0, 4000) : fallbackRequest;
  return { route: parsed.route as DirectRoute, company: named ?? null, request };
}

function conversation(prior: Turn[], text: string): string {
  const recent = prior
    .filter((t) => t.role !== 'status')
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'User' : 'Nucleas'}: ${t.text.replace(/\s+/g, ' ').slice(0, 600)}`);
  return [recent.length ? `Conversation so far:\n${recent.join('\n')}\n` : '', `Latest message:\n${text}`].join('\n');
}

/**
 * Sorts a Direct-mode request with the chosen free model. Returns null for paid models (they choose
 * tools well themselves) and whenever sorting fails, so the caller falls back to the usual loop.
 */
export async function routeDirectRequest(input: {
  modelProfileId: string;
  model: string;
  text: string;
  prior: Turn[];
  companies: string[];
  codeCompanies: string[];
  signal?: AbortSignal;
  invoke?: (gateway: GatewayConfiguration, request: ModelRequest) => Promise<{ content: string }>;
}): Promise<RouteDecision | null> {
  let gateway: GatewayConfiguration;
  let tier: string;
  let provider: string;
  try {
    ({ gateway, profile: { tier, provider } } = await gatewayFromModelProfile(input.modelProfileId, input.model));
  } catch {
    return null;
  }
  if (!isFreeCredential({ provider, tier })) return null;

  // Schema-guided JSON where the checks found the host supports it; otherwise any JSON object.
  const check =
    mongoose.connection.readyState === 1 && Types.ObjectId.isValid(input.modelProfileId)
      ? await AiModelCheck.findOne({ profileId: new Types.ObjectId(input.modelProfileId), model: input.model }).select('supports').lean<{ supports?: { jsonSchema?: boolean | null } }>()
      : null;
  const responseFormat: ModelRequest['responseFormat'] = check?.supports?.jsonSchema ? { type: 'json_schema', name: 'route', schema: routeSchema(input.companies) } : { type: 'json_object' };

  const token = randomUUID();
  try {
    // The free model is shared: wait for it like any chat.
    await waitForDispatchLock({ signal: input.signal });
    await holdDispatchLock(token, 3 * 60 * 1000);
    const reply = await (input.invoke ?? ((g, r) => invokeModel(g, r, { signal: input.signal })))(gateway, {
      role: 'worker',
      messages: [
        { role: 'system', content: routerPrompt(input.companies, input.codeCompanies) },
        { role: 'user', content: conversation(input.prior, input.text) },
      ],
      maxOutputTokens: 2048,
      responseFormat,
    });
    return parseDecision(reply.content, input.companies, input.text);
  } catch {
    return null;
  } finally {
    await releaseDispatchLock(token);
  }
}
