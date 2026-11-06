import { sameUrl } from '@/lib/ai/evidenceUrl';
import { isSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';

/** The material behind an answer, kept so a person can check it. Everything here came from the web, so it is shown as data only. */
export interface EvidenceSource {
  url: string;
  title: string;
  snippet?: string;
  /** The answer itself links to this page. */
  cited?: boolean;
  /** A worker opened this page. Without it, the page was only seen in search results. */
  read?: boolean;
  /** Nucleas tried this page and it does not exist. */
  gone?: boolean;
  /** Nucleas tried this page and could not read it, which proves nothing either way. */
  blocked?: boolean;
  /** What the answer says on the strength of this page: its sentences and table rows that link here. */
  usedFor?: string[];
  /** What the research notes recorded from this page. */
  found?: string[];
}
export interface EvidenceImage {
  imageUrl: string;
  title: string;
  /** The page the image was found on. */
  pageUrl?: string;
}
export interface EvidenceData {
  label: string;
  detail: string;
}
export interface AnswerEvidence {
  sources: EvidenceSource[];
  images: EvidenceImage[];
  data: EvidenceData[];
}

const MAX_SOURCES = 30;
const MAX_IMAGES = 24;
const MAX_IMAGES_PER_PAGE = 6;
const MAX_CLAIMS = 5;
const MAX_CLAIM_LENGTH = 280;
const MIN_CLAIM_LENGTH = 12;
const MAX_DATA = 12;
const clip = (text: unknown, max: number) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const withoutMarkdownLinks = (text: string) => text.replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, '$1');
/** What a page reader puts ahead of the text is not something a person wants to read as a summary. */
const readableSnippet = (text: unknown) =>
  typeof text === 'string' ? withoutMarkdownLinks(text.replace(/^\s*Public form controls parsed from HTML[^\n]*?\]\s*/i, '')) : text;

export function emptyEvidence(): AnswerEvidence {
  return { sources: [], images: [], data: [] };
}

export function addSource(evidence: AnswerEvidence, source: { url?: unknown; title?: unknown; snippet?: unknown; cited?: boolean; read?: boolean; gone?: boolean; blocked?: boolean }): void {
  const url = clip(source.url, 2000);
  if (!url || !isSafePublicHttpsUrl(url)) return;
  const existing = evidence.sources.find((row) => sameUrl(row.url) === sameUrl(url));
  const title = clip(source.title, 200);
  const snippet = clip(readableSnippet(source.snippet), 240);
  if (existing) {
    // The same page often turns up once as a bare link and later with its details.
    if (title && (!existing.title || existing.title === existing.url)) existing.title = title;
    if (snippet && !existing.snippet) existing.snippet = snippet;
    if (source.cited) existing.cited = true;
    if (source.read) {
      existing.read = true;
      delete existing.blocked;
    }
    if (source.gone) existing.gone = true;
    if (source.blocked && !existing.read) existing.blocked = true;
    return;
  }
  evidence.sources.push({ url, title: title || url, ...(snippet ? { snippet } : {}), ...(source.cited ? { cited: true } : {}), ...(source.read ? { read: true } : {}), ...(source.gone ? { gone: true } : {}), ...(source.blocked ? { blocked: true } : {}) });
}

export function addImage(evidence: AnswerEvidence, image: { imageUrl?: unknown; title?: unknown; pageUrl?: unknown }): void {
  const imageUrl = clip(image.imageUrl, 2000);
  if (!imageUrl || !isSafePublicHttpsUrl(imageUrl) || evidence.images.some((row) => row.imageUrl === imageUrl)) return;
  const pageUrl = clip(image.pageUrl, 2000);
  evidence.images.push({ imageUrl, title: clip(image.title, 200) || 'Image', ...(pageUrl && isSafePublicHttpsUrl(pageUrl) ? { pageUrl } : {}) });
}

export function mergeEvidence(into: AnswerEvidence, from: Partial<AnswerEvidence> | undefined | null): void {
  for (const source of from?.sources ?? []) addSource(into, source);
  for (const image of from?.images ?? []) addImage(into, image);
  for (const row of from?.data ?? []) into.data.push(row);
}

/** Every link in a piece of markdown, with its label when it has one. */
export function linksInText(text: string): { url: string; title?: string }[] {
  const found: { url: string; title?: string }[] = [];
  for (const match of text.matchAll(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)/g)) found.push({ url: match[2]!, title: match[1] });
  for (const match of text.replace(/\[[^\]\n]{1,200}\]\(https:\/\/[^\s)]+\)/g, ' ').matchAll(/https:\/\/[^\s<>()[\]"']+/g)) found.push({ url: match[0].replace(/[.,;:!?]+$/, '') });
  return found;
}

/** The statements in a piece of markdown: each table row, list item or sentence on its own. */
export function statementsIn(text: string): string[] {
  return text.split('\n').flatMap((rawLine) => {
    const line = rawLine.trim();
    if (!line || /^\|?[\s:|-]+\|?$/.test(line) || /^#{1,6}\s/.test(line)) return [];
    if (line.startsWith('|')) return [line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()).filter(Boolean).join(' · ')];
    const body = line.replace(/^(?:[-*+]|\d+[.)])\s+/, '');
    return /^(?:[-*+]|\d+[.)])\s/.test(line) ? [body] : body.split(/(?<=[.!?])\s+(?=[A-Z[(])/);
  });
}

/** A statement as a person reads it: its links become their labels. */
function readable(statement: string): string {
  return clip(withoutMarkdownLinks(statement).replace(/https:\/\/\S+/g, '').replace(/\*+|__|`/g, ''), MAX_CLAIM_LENGTH);
}

/** Ties statements to the pages they link to, in code, so "what came from this page" is what the text actually cites. */
function attachStatements(evidence: AnswerEvidence, text: string, field: 'usedFor' | 'found'): void {
  for (const statement of statementsIn(text)) {
    const claim = readable(statement);
    // "Review URL:" followed by a link names a field; it says nothing about the page.
    if (claim.length < MIN_CLAIM_LENGTH || /:\s*$/.test(statement.replace(/\[[^\]\n]*\]\([^)\s]*\)|https:\/\/\S+/g, ''))) continue;
    for (const link of linksInText(statement)) {
      const source = evidence.sources.find((row) => sameUrl(row.url) === sameUrl(link.url));
      if (!source) continue;
      const list = (source[field] ??= []);
      if (list.length < MAX_CLAIMS && !list.includes(claim)) list.push(claim);
    }
  }
}

/** Images worth keeping: those of the pages behind the answer first, and no single page crowding out the rest. */
function chooseImages(images: EvidenceImage[], sources: EvidenceSource[]): EvidenceImage[] {
  const rank = new Map(sources.map((source, index) => [sameUrl(source.url), index]));
  const perPage = new Map<string, number>();
  return [...images]
    .sort((a, b) => (rank.get(sameUrl(a.pageUrl ?? '')) ?? sources.length) - (rank.get(sameUrl(b.pageUrl ?? '')) ?? sources.length))
    .filter((image) => {
      const page = sameUrl(image.pageUrl ?? image.imageUrl);
      const count = perPage.get(page) ?? 0;
      perPage.set(page, count + 1);
      return count < MAX_IMAGES_PER_PAGE;
    })
    .slice(0, MAX_IMAGES);
}

/**
 * Finishes the evidence for an answer: pages it links to are marked and listed first, each page gets the statements
 * that rely on it, and the size is capped for storage. Notes are the research the answer was written from.
 */
export function finishEvidence(evidence: AnswerEvidence, answer: string, notes = ''): AnswerEvidence | undefined {
  for (const link of linksInText(answer)) addSource(evidence, { ...link, cited: true });
  attachStatements(evidence, answer, 'usedFor');
  attachStatements(evidence, notes, 'found');
  const weight = (source: EvidenceSource) => (source.cited ? 2 : source.read ? 1 : 0);
  const sources = [...evidence.sources].sort((a, b) => weight(b) - weight(a)).slice(0, MAX_SOURCES);
  const images = chooseImages(evidence.images, sources);
  const data = evidence.data.slice(0, MAX_DATA).map((row) => ({ label: row.label.slice(0, 120), detail: row.detail.slice(0, 1500) }));
  return sources.length || images.length || data.length ? { sources, images, data } : undefined;
}
