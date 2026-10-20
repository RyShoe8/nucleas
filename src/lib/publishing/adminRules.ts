import type { FormField, PublishingConfig } from './config';

export function applyAdminFieldRules(config: Pick<PublishingConfig, 'adminFieldRules' | 'adminValueField' | 'adminLinkField'>, values: Record<string, string | boolean>, valuePct?: number, sourceLink?: string | null): Record<string, string | boolean> {
  const result = { ...values };
  for (const rule of config.adminFieldRules ?? []) {
    const applies = rule.whenValueOverPct === undefined || (valuePct !== undefined && Number.isFinite(valuePct) && valuePct / 100 > rule.whenValueOverPct / 100 + Number.EPSILON);
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
