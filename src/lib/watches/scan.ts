import sanitizeHtml from 'sanitize-html';
import type { ParsedMessage } from '@/lib/mail/gmailParse';
import { dealStrengthPct } from './dealMetrics';
import { MAX_DISCOUNT_PCT } from './settings';
import type { DealMetrics } from './types';

/** The parts of a watch that decide which emails are looked at. Pure logic: no database, no network. */
export interface WatchRule {
  mode: 'match' | 'deal';
  description: string;
  keywords: string[];
  senderAddresses: string[];
  senderDomains: string[];
  labels: string[];
  lookbackHours: number;
  threshold: number;
  dealUnitTokens: string[];
}

export const MIN_BODY_CHARS = 80;
const MAX_TEXT_CHARS = 20_000;

/** The Gmail search for a watch: a date window plus optional label and sender clauses, all ANDed. */
export function gmailQueryFor(rule: Pick<WatchRule, 'labels' | 'senderAddresses' | 'senderDomains'>, lookbackHours: number, now = Date.now()): string {
  const parts: string[] = [];
  const after = new Date(now - lookbackHours * 3600 * 1000);
  parts.push(`after:${after.getFullYear()}/${after.getMonth() + 1}/${after.getDate()}`);
  const labels = rule.labels.map((l) => l.trim()).filter(Boolean);
  if (labels.length) {
    const clauses = labels.map((label) => `label:${label.includes(' ') ? `"${label.replace(/"/g, '')}"` : label}`);
    parts.push(clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0]!);
  }
  const from = [...rule.senderAddresses.map((a) => a.trim()), ...rule.senderDomains.map((d) => d.replace(/^@+/, '').trim())].filter(Boolean);
  if (from.length) {
    const inner = from.map((f) => `from:${f}`).join(' OR ');
    parts.push(from.length > 1 ? `(${inner})` : inner);
  }
  return parts.join(' ');
}

/** Look back only as far as needed: the configured window, or the time since the last scan if that is shorter. */
export function effectiveLookbackHours(configured: number, lastScanAt: Date | null | undefined, minGapHours = 2, now = Date.now()): number {
  if (!lastScanAt || !Number.isFinite(lastScanAt.getTime())) return configured;
  const gapHours = (now - lastScanAt.getTime()) / 3600_000;
  if (gapHours <= 0) return configured;
  return Math.min(configured, Math.max(minGapHours, gapHours));
}

/** Footer and legal markers; the body is cut at the earliest one that appears in its tail. */
const FOOTER_PATTERNS: RegExp[] = [
  /unsubscribe/i, /to unsubscribe/i, /view in browser/i, /view this email in your browser/i, /privacy policy/i,
  /you received this email/i, /you are receiving this/i, /why am i receiving/i, /why you're receiving/i,
  /manage your preferences/i, /update your preferences/i, /email preferences/i, /all rights reserved/i,
  /registered address/i, /registered office/i, /incorporated in/i, /company number/i, /this is an automated/i,
  /automated message/i, /please don['’]t reply/i, /do not reply to this email/i, /terms of service/i,
  /terms and conditions/i, /sweepstakes rules/i, /void where prohibited/i, /no purchase necessary/i,
  /add our email to your address book/i,
];

function stripFooter(text: string): string {
  const len = text.length;
  if (len < 120) return text.replace(/\s+/g, ' ').trim();
  const minStart = Math.max(200, Math.floor(len * 0.45));
  let cutAt = len;
  for (const pattern of FOOTER_PATTERNS) {
    const idx = text.search(pattern);
    if (idx >= minStart && idx < cutAt) cutAt = idx;
  }
  return text.slice(0, cutAt).replace(/\s+/g, ' ').trim();
}

/** The plain text of an email as the scan reads it: no markup, tracking noise, bracketed image links or footer. */
export function cleanEmailText(message: Pick<ParsedMessage, 'bodyText' | 'bodyHtml'>, maxChars = MAX_TEXT_CHARS): string {
  let text = message.bodyText?.trim() ?? '';
  if (text.length < 40 && message.bodyHtml) {
    text = sanitizeHtml(message.bodyHtml.replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/gi, ' ').replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h\d)>/gi, '\n'), { allowedTags: [], allowedAttributes: {} });
  }
  text = text.replace(/\s*\[https?:\/\/[^\]\s]+\.(?:png|jpe?g|gif|webp)(?:\?[^\]\s]*)?\]/gi, '').replace(/https?:\/\/\S{80,}/g, ' ');
  return stripFooter(text).slice(0, maxChars);
}

export function sendersMatch(fromEmail: string, rule: Pick<WatchRule, 'senderAddresses' | 'senderDomains'>): boolean {
  const addresses = rule.senderAddresses.map((a) => a.trim().toLowerCase().replace(/[<>]/g, '')).filter(Boolean);
  const domains = rule.senderDomains.map((d) => d.replace(/^@+/, '').trim().toLowerCase()).filter(Boolean);
  if (!addresses.length && !domains.length) return true;
  const email = fromEmail.toLowerCase();
  return addresses.some((a) => email.includes(a)) || domains.some((d) => email.endsWith(`@${d}`) || email.endsWith(`.${d}`));
}

export function detectKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((k) => k.trim() && lower.includes(k.trim().toLowerCase()));
}

export type PrefilterResult = { ok: true } | { ok: false; reason: string };

/** Cheap checks before any model is used: not too short, from an allowed sender, and mentioning a keyword if any are set. */
export function prefilter(message: { subject: string; fromEmail: string; text: string }, rule: Pick<WatchRule, 'keywords' | 'senderAddresses' | 'senderDomains'>, minBodyChars = MIN_BODY_CHARS): PrefilterResult {
  if (message.text.length < minBodyChars) return { ok: false, reason: `body_too_short:${message.text.length}` };
  if (!sendersMatch(message.fromEmail, rule)) return { ok: false, reason: 'sender_filter_mismatch' };
  const keywords = rule.keywords.map((k) => k.trim()).filter(Boolean);
  if (keywords.length && !detectKeywords(`${message.subject}\n${message.text}`, keywords).length) return { ok: false, reason: 'keyword_no_match' };
  return { ok: true };
}

const PROMO_PHRASES = ['bonus', 'free spins', 'match', 'reload', 'vip', 'wager', 'promo', '% off', 'limited time', 'claim now', 'exclusive offer'];

function keywordDensity(text: string, keywords: string[]): number {
  if (!keywords.length) return 0.2;
  const words = text.split(/\s+/).filter(Boolean).length || 1;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const k of keywords) {
    if (!k) continue;
    hits += lower.match(new RegExp(k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length ?? 0;
  }
  return Math.min(hits / words, 1) * 0.5;
}

/** Content Intelligence's 1-10 relevance: keyword density, how promotional it reads (deal watches only), and recency. */
export function relevanceScore(text: string, keywords: string[], sentAtMs: number, mode: WatchRule['mode'], now = Date.now()): number {
  const lower = text.toLowerCase();
  const promo = mode === 'deal' ? Math.min(PROMO_PHRASES.filter((p) => lower.includes(p)).length * 0.05, 0.35) : 0;
  const ageHours = Math.max(0, (now - sentAtMs) / 3600_000);
  const recency = Math.exp(-ageHours / (14 * 24)) * 0.35;
  const internal = Math.min(1, Math.max(0, keywordDensity(text, keywords) + promo + recency));
  return Math.round((1 + 9 * internal) * 10) / 10;
}

/** The score when no model is available (or the watch has no description): the share of keywords the email contains. */
export function keywordMatchScore(text: string, keywords: string[]): { score: number; reason: string } {
  const wanted = keywords.map((k) => k.trim()).filter(Boolean);
  if (!wanted.length) return { score: 0, reason: 'No keywords or description to match against.' };
  const found = detectKeywords(text, wanted);
  return { score: Math.round((found.length / wanted.length) * 100), reason: found.length ? `Mentions ${found.length} of ${wanted.length} keywords: ${found.slice(0, 5).join(', ')}.` : 'Mentions none of the keywords.' };
}

/** A discount watch scores an email by its best deal: the larger of the savings and the bonus, as a percent. Not capped at 100, so big bonuses still rank. */
export function dealScore(deal: DealMetrics | null | undefined): number {
  return deal ? Math.min(MAX_DISCOUNT_PCT, Math.max(0, Math.round(dealStrengthPct(deal) * 100))) : 0;
}

export function isFlagged(score: number, threshold: number): boolean {
  return score >= threshold;
}
