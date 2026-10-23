import type { AvailableModel } from '@/lib/ai/engine/catalog';
export const LINK_WORK_CALLS = 2;
export const LINK_REVIEW_TOKENS = 600;
export const LINK_PAID_REVIEW_MICROS = 20000;
/** Conservative plain-text token bound; unknown prices never qualify for paid review. */
export function affordableLinkReview(model: Pick<AvailableModel, 'free' | 'blendedPricePer1M'>, prompt: string, remainingMicros = LINK_PAID_REVIEW_MICROS): boolean {
  if (model.free) return true;
  if (model.blendedPricePer1M === null || !Number.isFinite(model.blendedPricePer1M) || model.blendedPricePer1M < 0) return false;
  const inputTokens = Buffer.byteLength(prompt, 'utf8') + 2048;
  return (inputTokens + LINK_REVIEW_TOKENS) * 4 * model.blendedPricePer1M <= remainingMicros;
}
