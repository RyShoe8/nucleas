import type { FormField, PublishingConfig } from './config';

export function applyAdminFieldRules(config: Pick<PublishingConfig, 'adminFieldRules' | 'adminValueField' | 'adminLinkField'>, values: Record<string, string | boolean>, valuePct?: number, sourceLink?: string | null, shareable = true): Record<string, string | boolean> {
  const result = { ...values };
  for (const rule of config.adminFieldRules ?? []) {
    const applies = rule.whenValueOverPct === undefined || (shareable && valuePct !== undefined && Number.isFinite(valuePct) && valuePct / 100 > rule.whenValueOverPct / 100 + Number.EPSILON);
    const value = applies ? rule.value : rule.otherwise;
    if (value === undefined) delete result[rule.field];
    else result[rule.field] = value;
  }
  if (config.adminValueField) {
    if (valuePct !== undefined && Number.isFinite(valuePct)) result[config.adminValueField] = String(Math.round(valuePct * 100) / 100);
    else delete result[config.adminValueField];
  }
  if (config.adminLinkField) {
    delete result[config.adminLinkField];
    if (sourceLink) {
      try {
        const url = new URL(sourceLink);
        if (url.protocol === 'https:' || url.protocol === 'http:') result[config.adminLinkField] = sourceLink;
      } catch { /* Do not replace missing source links with invented URLs. */ }
    }
  }
  return result;
}

const END_WORDS = /\b(?:end|ends|ending|expires?|expiry|expiration|until|through)\b/i;
const START_WORDS = /\b(?:start|starts|starting|begin|begins|from)\b/i;
const isDateField = (field: FormField) => field.type === 'date' || field.type === 'datetime-local';
const fieldWords = (field: FormField) => `${field.label ?? ''} ${field.key}`.replace(/[_-]+/g, ' ');
const pad = (n: number) => String(n).padStart(2, '0');

/** The amounts of the one deal a record is about. */
export interface DealAmounts { pay?: number; credit?: number }

const PAY_WORDS = /\b(?:spend|pay|price|cost)\b/i;
const CREDIT_WORDS = /\b(?:get|gets|receive|receives|credit|credits)\b/i;
const HEADING_WORDS = /\b(?:title|name|headline|slug)\b/i;

/**
 * An email can list several packages. The number fields for what is paid and what is received come from the same deal
 * as the verified value, never from a model's choice of package, so the three always describe one offer.
 */
export function withDealAmounts(fields: FormField[], values: Record<string, string | boolean>, deal?: DealAmounts): Record<string, string | boolean> {
  if (!deal) return values;
  const result = { ...values };
  const set = (words: RegExp, other: RegExp, amount?: number) => {
    if (amount === undefined || !Number.isFinite(amount)) return;
    const matches = fields.filter((f) => f.type === 'number' && words.test(fieldWords(f)) && !other.test(fieldWords(f)));
    if (matches.length === 1) result[matches[0]!.key] = String(amount);
  };
  set(PAY_WORDS, CREDIT_WORDS, deal.pay);
  set(CREDIT_WORDS, PAY_WORDS, deal.credit);
  return result;
}

/** Labels of the headings that call an offer free when it has a price. A person checks these before they go out. */
export function paidOfferCalledFree(fields: FormField[], values: Record<string, string | boolean>, deal?: DealAmounts): string[] {
  if (!deal?.pay) return [];
  return fields.filter((f) => f.type === 'text' && HEADING_WORDS.test(fieldWords(f)) && typeof values[f.key] === 'string' && /\bfree\b/i.test(values[f.key] as string)).map((f) => f.label || f.key);
}

/** What the model filling in a form has to know about the price, or it copies "FREE" straight from a promotional email. */
export function priceNotes(deal?: DealAmounts): string[] {
  if (!deal?.pay) return [];
  return [`Price: this offer costs $${deal.pay}. Do not use the word "free" in any title, name, headline or slug, even if the email does. Say what you pay and what you get.`];
}

const FREE_CORRECTION = 'Correction: your last answer used the word "free" in a title, name, headline or slug. This offer has a price, so rewrite those without that word.';

/**
 * Fills a form knowing the price, and asks once more if a heading still calls a paid offer free. A second answer is
 * used only if it fixes that; otherwise the first stands and the existing check holds it for a person.
 */
export async function fillWithoutCallingFree<T>(fill: (notes: string[]) => Promise<T | null>, calledFree: (filled: T) => string[], deal?: DealAmounts): Promise<T | null> {
  const notes = priceNotes(deal);
  const first = await fill(notes);
  if (!first || !calledFree(first).length) return first;
  const second = await fill([...notes, FREE_CORRECTION]);
  return second && !calledFree(second).length ? second : first;
}

/**
 * When the source gives no end date but the form has one (and a start date is filled in), the item ends one day
 * after it starts. An end date the source did give is never changed.
 */
export function withDefaultEndDate(fields: FormField[], values: Record<string, string | boolean>, days = 1): Record<string, string | boolean> {
  const end = fields.find((f) => isDateField(f) && END_WORDS.test(fieldWords(f)) && !START_WORDS.test(fieldWords(f)) && (values[f.key] === undefined || values[f.key] === ''));
  const start = fields.find((f) => isDateField(f) && START_WORDS.test(fieldWords(f)) && !END_WORDS.test(fieldWords(f)) && typeof values[f.key] === 'string' && values[f.key] !== '');
  if (!end || !start) return values;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(String(values[start.key]));
  if (!match) return values;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12));
  const day = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  return { ...values, [end.key]: end.type === 'date' ? day : `${day}T${match[4] ?? '23:59'}` };
}
