/**
 * What a watch collects, in a shape that fits any use: a plain-words rule for which emails count, the fields
 * to pull out of each one, and how to rank them. "Biggest discount" is one ranking among others, not a mode.
 * Pure logic, safe in the browser.
 */

export const WATCH_RANKS = ['fit', 'discount', 'newest'] as const;
export type WatchRank = (typeof WATCH_RANKS)[number];

export const RANK_LABELS: Record<WatchRank, { label: string; help: string }> = {
  fit: { label: 'Best fit first', help: 'Emails that match the rule most closely, and matter most, come first.' },
  discount: { label: 'Biggest discount first', help: 'Each email’s offer is read as what you pay against what you get. Larger savings or bonuses come first.' },
  newest: { label: 'Newest first', help: 'Everything that matches, most recent first.' },
};

export const FIELD_KINDS = ['text', 'number', 'money', 'date', 'url'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface WatchField {
  key: string;
  label: string;
  kind: FieldKind;
}

export const MAX_FIELDS = 12;
export const MAX_DISCOUNT_PCT = 1000;

/** "Regular price" → "regular_price": a stable key for a field label. */
export function fieldKey(label: string): string {
  return label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
}

/** Fields as stored: labelled, typed, unique keys, at most MAX_FIELDS. Anything malformed is dropped. */
export function cleanFields(raw: unknown): WatchField[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchField[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 60) : '';
    if (!label) continue;
    const key = fieldKey(typeof o.key === 'string' && o.key.trim() ? o.key : label);
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = (FIELD_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as FieldKind) : 'text';
    out.push({ key, label, kind });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** A model's values for the fields: only known keys, short strings, nothing empty. */
export function cleanValues(raw: unknown, fields: readonly WatchField[]): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = o[f.key];
    const text = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
    if (text && !/^(null|none|n\/a|unknown)$/i.test(text)) out[f.key] = text.slice(0, 300);
  }
  return out;
}

export interface WatchSettings {
  rank: WatchRank;
  /** 0-100: how closely an email must fit the rule to be flagged. Ignored when the watch has no rule. */
  fitThreshold: number;
  /** Discount ranking only: the smallest saving or bonus, in percent, worth flagging. */
  minDiscountPct: number;
  fields: WatchField[];
}

type StoredWatch = { mode?: string | null; rank?: string | null; threshold?: number | null; minDiscountPct?: number | null; fields?: unknown };

/**
 * A stored watch's settings. Watches saved before rankings existed had a mode instead: a "deal" watch's
 * threshold was the deal strength, so it becomes the discount minimum and the watch flags on that alone.
 */
export function watchSettings(row: StoredWatch): WatchSettings {
  const fields = cleanFields(row.fields);
  if (row.rank && (WATCH_RANKS as readonly string[]).includes(row.rank)) {
    return { rank: row.rank as WatchRank, fitThreshold: row.threshold ?? 60, minDiscountPct: row.minDiscountPct ?? 30, fields };
  }
  if (row.mode === 'deal') return { rank: 'discount', fitThreshold: 0, minDiscountPct: row.threshold ?? 30, fields };
  return { rank: 'fit', fitThreshold: row.threshold ?? 60, minDiscountPct: 30, fields };
}

/** The legacy mode the rest of the system still reads: a discount watch is a deal watch. */
export const legacyMode = (rank: WatchRank): 'match' | 'deal' => (rank === 'discount' ? 'deal' : 'match');

/**
 * Whether a scanned email is flagged: it fits the rule closely enough (when there is a rule) and, for a
 * discount watch, its offer is large enough. fit is null when nothing measured it (no rule).
 */
export function isWatchFlagged(input: { fit: number | null; discountPct: number | null }, settings: Pick<WatchSettings, 'rank' | 'fitThreshold' | 'minDiscountPct'>): boolean {
  if (input.fit != null && input.fit < settings.fitThreshold) return false;
  if (settings.rank === 'discount') return (input.discountPct ?? 0) >= settings.minDiscountPct && (input.discountPct ?? 0) > 0;
  return input.fit != null;
}

/** The order items are taken in for a digest or a roundup. */
export function compareByRank(rank: WatchRank) {
  return (a: { score?: number | null; sentAt?: Date | string | null }, b: { score?: number | null; sentAt?: Date | string | null }): number => {
    const time = (x: { sentAt?: Date | string | null }) => (x.sentAt ? new Date(x.sentAt).getTime() : 0);
    if (rank === 'newest') return time(b) - time(a);
    return (b.score ?? 0) - (a.score ?? 0) || time(b) - time(a);
  };
}

/** "$20 → 26 SC" style values as display lines: "Casino: Golden Hearts". */
export function valueLines(values: Record<string, string> | null | undefined, fields: readonly WatchField[]): string[] {
  if (!values) return [];
  const labels = new Map(fields.map((f) => [f.key, f.label]));
  return Object.entries(values).filter(([, v]) => v).map(([k, v]) => `${labels.get(k) ?? k.replace(/_/g, ' ')}: ${v}`);
}
