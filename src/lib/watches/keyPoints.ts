import { KEY_POINT_CATEGORIES, type KeyPoint, type KeyPointCategory } from './types';

const MAX_KEY_POINTS = 16;
const CATEGORY_SET = new Set<string>(KEY_POINT_CATEGORIES);

export function normalizeKeyPointCategory(raw: unknown): KeyPointCategory {
  return typeof raw === 'string' && CATEGORY_SET.has(raw) ? (raw as KeyPointCategory) : 'other';
}

/** Split a compound bullet ("a; b • c") into one fact per line. */
export function splitCompoundKeyPointText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts: string[] = [];
  for (const line of trimmed.split(/\n+/)) {
    const chunks = line.split(/\s*;\s*|\s*•\s*|\s*\|\s*/).flatMap((chunk) => {
      const numbered = chunk.split(/\s*(?=\d{1,2}[.)]\s+)/);
      return numbered.length > 1 ? numbered : [chunk];
    });
    for (let chunk of chunks) {
      chunk = chunk.replace(/^\d{1,2}[.)]\s*/, '').replace(/^[-*]\s+/, '').trim();
      if (chunk.length >= 8) parts.push(chunk);
    }
  }
  if (parts.length === 0 && trimmed.length >= 8) return [trimmed];
  return parts;
}

function dedupe(points: KeyPoint[]): KeyPoint[] {
  const seen = new Set<string>();
  const out: KeyPoint[] = [];
  for (const p of points) {
    const key = `${p.category}:${p.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= MAX_KEY_POINTS) break;
  }
  return out;
}

/** Compound entries become atomic key points. */
export function expandKeyPoints(points: KeyPoint[]): KeyPoint[] {
  const expanded: KeyPoint[] = [];
  for (const p of points) {
    const splits = splitCompoundKeyPointText(p.text);
    if (splits.length <= 1) expanded.push(p);
    else for (const text of splits) expanded.push({ category: p.category, text: text.slice(0, 500) });
  }
  return dedupe(expanded);
}

/** Key points from a model's JSON array (strings or {category,text} objects). */
export function parseKeyPoints(items: unknown): KeyPoint[] {
  if (!Array.isArray(items)) return [];
  const out: KeyPoint[] = [];
  for (const x of items) {
    if (typeof x === 'string') {
      const text = x.trim().slice(0, 500);
      if (text) out.push({ category: 'other', text });
    } else if (x && typeof x === 'object') {
      const o = x as { category?: unknown; text?: unknown };
      const text = typeof o.text === 'string' ? o.text.trim().slice(0, 500) : '';
      if (text) out.push({ category: normalizeKeyPointCategory(o.category), text });
    }
    if (out.length >= MAX_KEY_POINTS) break;
  }
  return expandKeyPoints(out);
}

const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const PATTERNS: { category: KeyPointCategory; re: RegExp }[] = [
  { category: 'deadline', re: /\b(?:must\s+)?claim\s+(?:by|before)\s+[^.\n]{4,120}/gi },
  { category: 'deadline', re: /\b(?:valid|available)\s+(?:until|through|from)\s+[^.\n]{4,120}/gi },
  { category: 'terms', re: /\b(?:no\s+purchase\s+necessary)\b/gi },
  { category: 'terms', re: /\bvoid\s+where\s+prohibited\b/gi },
  { category: 'eligibility', re: /\b(?:not\s+)?available\s+in\s+(?:all\s+)?states?\b/gi },
  { category: 'deadline', re: new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:\\s*[-–]\\s*(?:${MONTH})?\\s*\\d{1,2})?(?:,?\\s*\\d{4})?`, 'gi') },
  { category: 'deadline', re: /\b\d{1,2}:\d{2}\s*(?:am|pm)\s*(?:ET|PT|PST|EST|CT)\b/gi },
  { category: 'deadline', re: /\b(?:tournament|promo|offer|deal|sale)\s+(?:runs?|from|ends?)\s+[^.\n]{4,100}/gi },
];

/** Key points found with patterns alone, used when no model is available or its reply is unusable. */
export function extractKeyPointsFallback(text: string, subject = ''): KeyPoint[] {
  const combined = `${subject}\n${text}`.slice(0, 20_000);
  const seen = new Set<string>();
  const out: KeyPoint[] = [];
  for (const { category, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(combined)) !== null && out.length < MAX_KEY_POINTS) {
      const s = m[0].replace(/\s+/g, ' ').trim();
      if (s.length < 8 || s.length > 500) continue;
      const key = `${category}:${s.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ category, text: s.charAt(0).toUpperCase() + s.slice(1) });
    }
  }
  return expandKeyPoints(out);
}
