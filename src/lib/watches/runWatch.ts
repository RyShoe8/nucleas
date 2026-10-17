import 'server-only';
import { Types } from 'mongoose';
import { ContentWatch, WatchItem, WatchMailbox, type ContentWatchDoc } from '@/lib/models/Watch';
import { openSecret } from '@/lib/security/secretBox';
import { GmailApi, GmailAuthError, refreshAccessToken } from '@/lib/mail/gmailClient';
import { parseGmailMessage, type ParsedMessage } from '@/lib/mail/gmailParse';
import { extractDealMetricsRegex, extractDealsFoundRegex, mergeDealExtractions, pickBestDeal } from './dealMetrics';
import { extractAnchorHrefs, pickDealLink } from './dealLink';
import { extractKeyPointsFallback } from './keyPoints';
import { cleanEmailText, dealScore, detectKeywords, effectiveLookbackHours, gmailQueryFor, keywordMatchScore, prefilter, relevanceScore, type WatchRule } from './scan';
import { isWatchFlagged, legacyMode, watchSettings, type WatchSettings } from './settings';
import { analyzeEmail, type AnalyzeFn } from './scanAi';
import { formatDealLine } from './dealFormat';
import type { DealMetrics } from './types';

/** Scans one watch: lists new mail in its mailbox, scores each email against the rule, and stores the results. */

export const watchMailboxPurpose = (email: string) => `watch-mailbox:${email.toLowerCase()}`;
const LEASE_MS = 6 * 60_000;
const RETENTION_DAYS = 90;
const DEFAULT_MAX_NEW = 40;
const DEFAULT_BUDGET_MS = 230_000;

export interface ScanStats {
  listed: number;
  fresh: number;
  stored: number;
  skipped: number;
  scored: number;
  flagged: number;
  modelFailures: number;
  /** More new mail remains than one scan handles; the next scan continues. */
  partial: boolean;
}

export type ScanOutcome = { ok: true; stats: ScanStats } | { ok: false; error: string; needsReauth?: boolean };

export interface ScanDeps {
  api?: GmailApi;
  analyze?: AnalyzeFn;
  now?: () => number;
  maxNew?: number;
  budgetMs?: number;
}

type WatchRow = ContentWatchDoc & { _id: Types.ObjectId };

export function ruleOf(watch: Pick<ContentWatchDoc, 'mode' | 'description' | 'keywords' | 'senderAddresses' | 'senderDomains' | 'labels' | 'lookbackHours' | 'threshold' | 'dealUnitTokens'> & { rank?: string | null; minDiscountPct?: number | null; fields?: unknown }): WatchRule & { settings: WatchSettings } {
  const settings = watchSettings(watch);
  return {
    settings,
    mode: legacyMode(settings.rank),
    description: watch.description ?? '',
    keywords: (watch.keywords ?? []).map((k) => k.trim()).filter(Boolean),
    senderAddresses: watch.senderAddresses ?? [],
    senderDomains: watch.senderDomains ?? [],
    labels: watch.labels ?? [],
    lookbackHours: watch.lookbackHours ?? 168,
    threshold: settings.fitThreshold,
    dealUnitTokens: (watch.dealUnitTokens ?? []).map((t) => t.trim()).filter(Boolean),
  };
}

function credentials() {
  const clientId = process.env.GOOGLE_MAIL_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_MAIL_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google sign-in is not configured.');
  return { clientId, clientSecret };
}

const tokenCache = new Map<string, { token: string; expires: number }>();

async function apiForMailbox(mailbox: { _id: Types.ObjectId; emailAddress: string; refreshTokenSealed: string }): Promise<GmailApi> {
  const key = String(mailbox._id);
  const cached = tokenCache.get(key);
  if (cached && cached.expires > Date.now()) return new GmailApi(cached.token);
  const { accessToken, expiresInSeconds } = await refreshAccessToken(openSecret(watchMailboxPurpose(mailbox.emailAddress), mailbox.refreshTokenSealed), credentials());
  tokenCache.set(key, { token: accessToken, expires: Date.now() + Math.max(60, expiresInSeconds - 300) * 1000 });
  return new GmailApi(accessToken);
}

function itemFields(watch: WatchRow, m: ParsedMessage) {
  return {
    organizationId: watch.organizationId,
    watchId: watch._id,
    mailboxId: watch.mailboxId,
    gmailId: m.gmailId,
    threadId: m.threadId,
    fromName: m.from.name?.slice(0, 200),
    fromEmail: m.from.email.toLowerCase().slice(0, 320),
    subject: m.subject,
    sentAt: m.internalDate,
  };
}

async function processMessage(watch: WatchRow, m: ParsedMessage, deps: Required<Pick<ScanDeps, 'analyze'>>, stats: ScanStats, nowMs: number): Promise<void> {
  const rule = ruleOf(watch);
  const base = itemFields(watch, m);
  const text = cleanEmailText(m);

  if (m.sent || m.labels.includes('DRAFT') || m.labels.includes('SPAM') || m.labels.includes('TRASH')) {
    await WatchItem.updateOne({ watchId: watch._id, gmailId: m.gmailId }, { $set: { ...base, skipReason: 'own_or_spam', text: '', flagged: false, score: 0, scoreBasis: 'none' } }, { upsert: true });
    stats.stored += 1;
    stats.skipped += 1;
    return;
  }

  const pf = prefilter({ subject: m.subject, fromEmail: base.fromEmail, text }, rule);
  if (!pf.ok) {
    await WatchItem.updateOne({ watchId: watch._id, gmailId: m.gmailId }, { $set: { ...base, skipReason: pf.reason.slice(0, 80), text: text.slice(0, 2000), flagged: false, score: 0, scoreBasis: 'none', relevance: 1 } }, { upsert: true });
    stats.stored += 1;
    stats.skipped += 1;
    return;
  }

  const sentAtMs = m.internalDate.getTime();
  const detectedKeywords = detectKeywords(`${m.subject}\n${text}`, rule.keywords);
  const relevance = relevanceScore(text, rule.keywords, sentAtMs, rule.mode, nowMs);
  const { settings } = rule;
  const needsModel = Boolean(rule.description.trim()) || rule.mode === 'deal' || settings.fields.length > 0 || watch.aiSummary !== false;
  let analysis = null;
  if (needsModel) {
    try {
      analysis = await deps.analyze({
        organizationId: String(watch.organizationId),
        userId: String(watch.createdByUserId),
        mode: rule.mode,
        description: rule.description,
        dealUnitTokens: rule.dealUnitTokens,
        fields: settings.fields,
        subject: m.subject,
        from: base.fromEmail,
        text,
        wantSummary: watch.aiSummary !== false,
      });
    } catch (error) {
      console.error('[watches] analysis failed', error instanceof Error ? error.message : 'unknown');
    }
    if (!analysis) stats.modelFailures += 1;
  }

  // Fit to the rule: the model's judgement, else the keyword share. A discount watch with no rule (or whose
  // model failed) is not held back by fit: its offer decides.
  let fit: number | null = null;
  let scoreBasis: 'ai' | 'keywords' | 'deal' | 'none' = 'none';
  let reason = '';
  if (analysis?.match) {
    fit = analysis.match.score;
    scoreBasis = 'ai';
    reason = analysis.match.reason;
  } else if (settings.rank !== 'discount') {
    const fallback = keywordMatchScore(`${m.subject}\n${text}`, rule.keywords);
    fit = fallback.score;
    scoreBasis = rule.keywords.length ? 'keywords' : 'none';
    reason = fallback.reason;
  }

  let deals: DealMetrics[] = [];
  let best: DealMetrics | null = null;
  let discountPct: number | null = null;
  if (settings.rank === 'discount') {
    deals = extractDealsFoundRegex(m.subject, text, rule.dealUnitTokens);
    const regexBest = pickBestDeal(deals) ?? extractDealMetricsRegex(m.subject, text, rule.dealUnitTokens);
    best = mergeDealExtractions(analysis?.deal ?? null, regexBest, `${m.subject}\n${text}`) ?? null;
    if (best && !deals.length) deals = [best];
    discountPct = dealScore(best);
    scoreBasis = 'deal';
    const line = best ? formatDealLine(best) : 'No offer found in this email.';
    reason = reason ? `${line} ${reason}` : line;
  }

  const score = settings.rank === 'discount' ? discountPct ?? 0 : fit ?? 0;
  const flagged = isWatchFlagged({ fit, discountPct }, settings);
  await WatchItem.updateOne(
    { watchId: watch._id, gmailId: m.gmailId },
    {
      $set: {
        ...base,
        text,
        detectedKeywords,
        relevance,
        score,
        ...(fit != null ? { fit } : {}),
        scoreBasis,
        reason: reason.slice(0, 300),
        flagged,
        summary: analysis?.summary || undefined,
        keyPoints: analysis?.keyPoints.length ? analysis.keyPoints : extractKeyPointsFallback(text, m.subject),
        deals,
        bestDeal: best ?? undefined,
        values: analysis?.values && Object.keys(analysis.values).length ? analysis.values : undefined,
        link: pickDealLink(extractAnchorHrefs(m.bodyHtml), { html: m.bodyHtml, subject: m.subject, from: m.from.email }) ?? undefined,
        htmlPreview: m.bodyHtml.slice(0, 80_000) || undefined,
      },
      $unset: { skipReason: '' },
    },
    { upsert: true }
  );
  stats.stored += 1;
  stats.scored += 1;
  if (flagged) stats.flagged += 1;
}

/** Scans one watch now. A lease keeps overlapping runs (button, cron) from scanning the same watch twice. */
export async function scanWatch(watchId: Types.ObjectId | string, deps: ScanDeps = {}): Promise<ScanOutcome> {
  const id = new Types.ObjectId(String(watchId));
  const nowFn = deps.now ?? Date.now;
  const started = nowFn();
  const watch = await ContentWatch.findOneAndUpdate(
    { _id: id, $or: [{ scanLeaseUntil: { $exists: false } }, { scanLeaseUntil: null }, { scanLeaseUntil: { $lt: new Date(started) } }] },
    { $set: { scanLeaseUntil: new Date(started + LEASE_MS) } },
    { new: true }
  ).lean<WatchRow>();
  if (!watch) return { ok: false, error: 'This watch is already being scanned.' };

  const stats: ScanStats = { listed: 0, fresh: 0, stored: 0, skipped: 0, scored: 0, flagged: 0, modelFailures: 0, partial: false };
  try {
    const mailbox = await WatchMailbox.findOne({ _id: watch.mailboxId, organizationId: watch.organizationId }).select('+refreshTokenSealed emailAddress status').lean<{ _id: Types.ObjectId; emailAddress: string; refreshTokenSealed: string; status: string }>();
    if (!mailbox) throw new Error('The mailbox for this watch was removed. Connect it again.');
    if (mailbox.status === 'needs_reauth') throw new GmailAuthError('This mailbox needs to be connected again.');
    const api = deps.api ?? (await apiForMailbox(mailbox));
    const rule = ruleOf(watch);
    const lookback = effectiveLookbackHours(rule.lookbackHours, watch.lastScanAt ?? null, 2, started);
    const listed = await api.listMessageIds({ q: gmailQueryFor(rule, lookback, started), maxResults: 100 });
    stats.listed = listed.ids.length;
    const known = new Set((await WatchItem.find({ watchId: id, gmailId: { $in: listed.ids } }).select('gmailId').lean<{ gmailId: string }[]>()).map((r) => r.gmailId));
    const fresh = listed.ids.filter((gmailId) => !known.has(gmailId));
    stats.fresh = fresh.length;
    const maxNew = deps.maxNew ?? DEFAULT_MAX_NEW;
    const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;
    const analyze = deps.analyze ?? analyzeEmail;
    for (const gmailId of fresh) {
      if (stats.stored >= maxNew || nowFn() - started > budget) {
        stats.partial = true;
        break;
      }
      try {
        const parsed = parseGmailMessage(await api.getMessage(gmailId));
        await processMessage(watch, parsed, { analyze }, stats, nowFn());
      } catch (error) {
        if (error instanceof GmailAuthError) throw error;
        // A message deleted between listing and fetching is simply gone; anything else is retried next scan.
        if (!(error instanceof Error && /returned 404/.test(error.message))) console.error('[watches] message failed', error instanceof Error ? error.message : 'unknown');
      }
    }
    if (listed.nextPageToken && !stats.partial && fresh.length === listed.ids.length) stats.partial = true;
    await WatchItem.deleteMany({ watchId: id, sentAt: { $lt: new Date(started - RETENTION_DAYS * 86400_000) } });
    await ContentWatch.updateOne({ _id: id }, { $set: { lastScanAt: new Date(started), lastScanOk: true, lastScanStats: stats }, $unset: { lastScanError: '', scanLeaseUntil: '' } });
    return { ok: true, stats };
  } catch (error) {
    const reauth = error instanceof GmailAuthError;
    const message = error instanceof Error ? error.message.slice(0, 300) : 'The scan failed.';
    if (reauth) {
      tokenCache.delete(String(watch.mailboxId));
      await WatchMailbox.updateOne({ _id: watch.mailboxId }, { $set: { status: 'needs_reauth', lastError: message } });
    }
    await ContentWatch.updateOne({ _id: id }, { $set: { lastScanAt: new Date(started), lastScanOk: false, lastScanError: message, lastScanStats: stats }, $unset: { scanLeaseUntil: '' } });
    return { ok: false, error: message, needsReauth: reauth };
  }
}

/** Active watches whose interval has elapsed, oldest scan first (for the cron). Watches on a mailbox that needs reconnecting are skipped. */
export async function scanDueWatches(options: { limit?: number; now?: number; afterScan?: (watchId: Types.ObjectId, since: Date) => Promise<unknown> } = {}): Promise<{ scanned: number; failed: number }> {
  const now = options.now ?? Date.now();
  const candidates = await ContentWatch.find({ active: true })
    .sort({ lastScanAt: 1 })
    .limit(50)
    .select('_id mailboxId lastScanAt intervalMinutes')
    .lean<{ _id: Types.ObjectId; mailboxId: Types.ObjectId; lastScanAt?: Date; intervalMinutes?: number }[]>();
  const broken = new Set((await WatchMailbox.find({ status: 'needs_reauth' }).select('_id').lean<{ _id: Types.ObjectId }[]>()).map((r) => String(r._id)));
  const due = candidates.filter((w) => !broken.has(String(w.mailboxId)) && (!w.lastScanAt || now - w.lastScanAt.getTime() >= (w.intervalMinutes ?? 60) * 60_000)).slice(0, options.limit ?? 3);
  let scanned = 0;
  let failed = 0;
  for (const watch of due) {
    const since = new Date();
    const outcome = await scanWatch(watch._id);
    if (outcome.ok) {
      scanned += 1;
      // Optional follow-up for newly flagged mail (social post drafts); a failure here never fails the scan.
      await options.afterScan?.(watch._id, since).catch((error: unknown) => console.error('[watches] follow-up failed', error instanceof Error ? error.message : 'unknown'));
    } else failed += 1;
  }
  return { scanned, failed };
}
