import { inflateSync } from 'node:zlib';

/** Picks the one link an email is really about, ignoring unsubscribe, social, tracking and asset links. */
const NON_DEAL_URL_RE =
  /w3\.org\/1999\/xhtml|w3\.org\/TR\/|w3\.org\/2000\/|schemas\.microsoft\.com|xmlns|\.dtd(?:\?|$)|fonts\.googleapis\.com|fonts\.gstatic\.com|\/css(?:\?|\/|$)|\.css(?:\?|$)/i;

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg)(?:\?|$)/i;

const EMAIL_ASSET_RE = /responsysimages|\/assets\/responsys|_Email_|_600W\.png/i;

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Assets, schemas and stylesheets that are never the page an email is about. */
export function isNonDealUrl(url: string): boolean {
  if (!url?.trim()) return true;
  if (NON_DEAL_URL_RE.test(url)) return true;
  if (EMAIL_ASSET_RE.test(url)) return true;
  const path = pathnameOf(url);
  return IMAGE_EXT_RE.test(path) || IMAGE_EXT_RE.test(url);
}

export function sanitizeDealUrl(url: string | null | undefined): string | null {
  if (url == null) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (isNonDealUrl(trimmed)) return null;
  return trimmed;
}


export type PickDealLinkContext = {
  html?: string;
  subject?: string;
  from?: string;
};


const DENY_URL_RE =
  /unsubscribe|preferences|privacy|terms|mailto:|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|google\.com\/maps|apps\.apple\.com|play\.google\.com/i;

const ESP_TRACKING_RE =
  /exponea\.com|responsys\.com|click\.(?:sendgrid|mailchimp)|\/click(?:\/|\?|$)/i;

const PROMO_URL_RE =
  /shop|play|claim|bonus|promo|offer|deposit|spin|register|signup|sign-up|get-started|cta|reward|package|bundle|buy|purchase|article|post|story|news|read|learn/i;

const PROMO_ANCHOR_RE =
  /let['’]?s (?:roll|ride|play)|grab (?:your|the)|get deal|shop now|play now|claim|get bonus|get offer|deposit|spin|buy now|purchase|redeem|click here|play free|join now|tap the button|read more|learn more|view|see (?:the )?(?:offer|details|deal)|get started/i;

function normalizeUrl(url: string): string {
  return url.replace(/&amp;/gi, "&").replace(/[,.)]+$/, "").trim();
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

function isDenied(url: string): boolean {
  if (DENY_URL_RE.test(url) || isNonDealUrl(url)) return true;
  // Bloomreach/Exponea embeds the destination in a signed base64 payload. Inspect it
  // locally: following a footer URL could itself unsubscribe the mailbox.
  try {
    const parsed = new URL(url);
    if (!/(^|\.)exponea\.com$/i.test(parsed.hostname)) return false;
    const token = parsed.pathname.split('/e/')[1]?.split('/')[0];
    if (!token || token.length > 20000) return false;
    const compressed = token.startsWith('.');
    const encoded = token.split('.')[compressed ? 1 : 0];
    const bytes = Buffer.from(encoded, 'base64url');
    const payload = compressed ? inflateSync(bytes, { maxOutputLength: 65536 }) : bytes;
    return DENY_URL_RE.test(payload.toString('utf8'));
  } catch { return false; }
}

function parseSenderDomain(from: string | undefined): string | null {
  if (!from) return null;
  const angle = from.match(/<([^>]+@[^>]+)>/);
  const email = angle?.[1] ?? from.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0];
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1).toLowerCase();
}

function hostMatchesSender(url: string, senderDomain: string | null): boolean {
  if (!senderDomain) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === senderDomain || host.endsWith(`.${senderDomain}`);
  } catch {
    return false;
  }
}

function scoreUrl(
  url: string,
  anchorText?: string,
  subject?: string,
  from?: string,
): number {
  if (!isHttpUrl(url)) return -100;
  if (isDenied(url)) return -50;

  let score = 0;
  if (PROMO_URL_RE.test(url)) score += 3;
  if (anchorText && /unsubscribe|opt[ -]?out|preferences|privacy|terms|contact|support|faq/i.test(anchorText)) return -50;
  if (anchorText && PROMO_ANCHOR_RE.test(anchorText)) score += 4;
  if (anchorText && PROMO_URL_RE.test(anchorText)) score += 2;
  if (subject && PROMO_URL_RE.test(subject)) score += 1;
  if (ESP_TRACKING_RE.test(url)) score -= 3;
  if (hostMatchesSender(url, parseSenderDomain(from))) score += 3;
  return score;
}

/** Remove xmlns attributes so namespace URLs are not picked up as links. */
export function stripXmlnsFromHtml(html: string): string {
  return html.replace(/\s+xmlns=(?:"[^"]*"|'[^']*')/gi, "");
}

function extractAnchorsFromHtml(html: string): { url: string; text: string }[] {
  const cleaned = stripXmlnsFromHtml(html);
  const out: { url: string; text: string }[] = [];
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const url = normalizeUrl(m[1].trim());
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (isHttpUrl(url) && !isNonDealUrl(url)) out.push({ url, text });
  }
  return out;
}

export function extractAnchorHrefs(html: string): string[] {
  return extractAnchorsFromHtml(html).map(({ url }) => url);
}

function fallbackLink(links: string[], context?: PickDealLinkContext): string | null {
  for (const link of links) {
    const normalized = normalizeUrl(link);
    const score = scoreUrl(normalized, undefined, context?.subject, context?.from);
    if (score <= 0) continue;
    const safe = sanitizeDealUrl(normalized);
    if (safe && normalized.startsWith("https://")) return safe;
  }
  for (const link of links) {
    const normalized = normalizeUrl(link);
    const score = scoreUrl(normalized, undefined, context?.subject, context?.from);
    if (score > 0 && normalized.startsWith("http://")) {
      const safe = sanitizeDealUrl(normalized);
      if (safe) return safe;
    }
  }
  return null;
}

export function pickDealLink(links: string[], context?: PickDealLinkContext): string | null {
  const subject = context?.subject;
  const from = context?.from;
  const candidates = new Map<string, number>();
  const deniedAnchors = new Set<string>();

  const addCandidate = (url: string, anchorText?: string) => {
    const normalized = normalizeUrl(url);
    if (!isHttpUrl(normalized) || isNonDealUrl(normalized)) return;
    if (deniedAnchors.has(normalized)) return;
    const score = scoreUrl(normalized, anchorText, subject, from);
    if (score <= -50) { deniedAnchors.add(normalized); candidates.delete(normalized); return; }
    const prev = candidates.get(normalized) ?? -100;
    candidates.set(normalized, Math.max(prev, score));
  };

  if (context?.html) {
    for (const { url, text } of extractAnchorsFromHtml(context.html)) {
      addCandidate(url, text);
    }
  }

  for (const link of links) {
    if (!isNonDealUrl(link)) addCandidate(link);
  }

  let bestUrl: string | null = null;
  let bestScore = -1;
  for (const [url, score] of candidates) {
    if (score > bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }

  if (bestUrl && bestScore > 0) return sanitizeDealUrl(bestUrl);

  return fallbackLink(links.filter((link) => !deniedAnchors.has(normalizeUrl(link))), context);
}
