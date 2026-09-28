import 'server-only';
import { Types } from 'mongoose';
import { selectModel, type CostLevel } from '@/lib/ai/engine/select';
import { listAvailableModels, priceTokens } from '@/lib/ai/engine/catalog';
import { recordModelFailure, recordModelSuccess } from '@/lib/ai/engine/health';
import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';
import { sanitizeProviderMessage } from '@nucleas/ai-core/gateway';
import { AiRun } from '@/lib/models/AiControl';

/**
 * Turns an attached image into text any model can use: a vision model (the engine's vision pick at
 * the request's cost level) describes it and transcribes all visible text. Recorded for AI Spend.
 */

const PROMPT = [
  'Describe this image for someone who cannot see it, so they can answer questions about it.',
  'Transcribe ALL visible text exactly (UI labels, headings, table cells, error messages, code), keeping its structure.',
  'Then describe the layout and anything notable (charts with their values, highlighted items, errors, what is selected).',
  'Be factual and complete; do not guess beyond what is visible. Plain markdown.',
].join(' ');

export interface ImageDescription {
  ok: boolean;
  text: string;
  model: string | null;
  costMicros: number | null;
}

export async function describeImage(input: {
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  level: CostLevel;
  name: string;
  imageDataUrl: string;
  signal?: AbortSignal;
}): Promise<ImageDescription> {
  const models = await listAvailableModels();
  const pick = await selectModel(input.organizationId, 'vision', input.level, { models });
  // Free vision model first; at medium (and when the free one fails) the paid pick.
  const choices = [pick.primary, pick.fallback].filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (!choices.length) return { ok: false, text: 'No vision model is available, so the image could not be read.', model: null, costMicros: null };

  let lastError = 'The vision model could not read the image.';
  for (const choice of choices) {
    const started = new Date();
    try {
      const { gateway } = await gatewayFromModelProfile(choice.profileId, choice.model);
      const response = await fetch(gateway.endpoint, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: input.signal ?? AbortSignal.timeout(120_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gateway.bearerToken}` },
        body: JSON.stringify({
          model: choice.model,
          max_tokens: 2000,
          messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: input.imageDataUrl } }] }],
        }),
      });
      if (!response.ok) {
        const message = sanitizeProviderMessage(await response.text().catch(() => ''), [gateway.bearerToken]);
        await recordModelFailure({ profileId: choice.profileId, model: choice.model, httpStatus: response.status, message }).catch(() => undefined);
        lastError = `${choice.model} returned HTTP ${response.status}${message ? `: ${message}` : ''}.`;
        continue;
      }
      const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = body.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() : '';
      if (!text) {
        lastError = `${choice.model} returned an empty description.`;
        continue;
      }
      void recordModelSuccess(choice.profileId, choice.model).catch(() => undefined);
      const usage = { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 };
      const provider = models.find((m) => m.profileId === choice.profileId && m.model === choice.model)?.provider;
      const costMicros = body.usage ? await priceTokens({ model: choice.model, provider, free: choice.free, ...usage }) : choice.free ? 0 : null;
      await AiRun.create({
        organizationId: input.organizationId,
        projectId: input.projectId,
        role: 'worker',
        status: 'completed',
        model: choice.model,
        inputDigest: `attachment:${input.name}:${started.getTime()}`,
        policyDigest: 'attachment-vision',
        createdByUserId: new Types.ObjectId(input.userId),
        startedAt: started,
        completedAt: new Date(),
        ...(body.usage ? usage : {}),
        ...(costMicros !== null ? { costMicros } : {}),
      }).catch(() => undefined);
      return { ok: true, text: text.slice(0, 20_000), model: choice.model, costMicros };
    } catch (error) {
      lastError = error instanceof Error && error.name === 'AbortError' ? 'The vision model timed out.' : 'The vision model could not be reached.';
    }
  }
  return { ok: false, text: lastError, model: null, costMicros: null };
}
