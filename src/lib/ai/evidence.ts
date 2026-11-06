import { isSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';

/** The material behind an answer, kept so a person can check it. Everything here came from the web, so it is shown as data only. */
export interface EvidenceSource {
  url: string;
  title: string;
  snippet?: string;
  /** The answer itself links to this page. */
  cited?: boolean;
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
const MAX_IMAGES = 18;
const MAX_DATA = 12;
const clip = (text: unknown, max: number) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const sameUrl = (url: string) => url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();

export function emptyEvidence(): AnswerEvidence {
  return { sources: [], images: [], data: [] };
}

export function addSource(evidence: AnswerEvidence, source: { url?: unknown; title?: unknown; snippet?: unknown; cited?: boolean }): void {
  const url = clip(source.url, 2000);
  if (!url || !isSafePublicHttpsUrl(url)) return;
  const existing = evidence.sources.find((row) => sameUrl(row.url) === sameUrl(url));
  const title = clip(source.title, 200);
  const snippet = clip(source.snippet, 240);
  if (existing) {
    // The same page often turns up once as a bare link and later with its details.
    if (title && (!existing.title || existing.title === existing.url)) existing.title = title;
    if (snippet && !existing.snippet) existing.snippet = snippet;
    if (source.cited) existing.cited = true;
    return;
  }
  evidence.sources.push({ url, title: title || url, ...(snippet ? { snippet } : {}), ...(source.cited ? { cited: true } : {}) });
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

/** Finishes the evidence for an answer: pages it links to are marked and listed first, and the size is capped for storage. */
export function finishEvidence(evidence: AnswerEvidence, answer: string): AnswerEvidence | undefined {
  for (const link of linksInText(answer)) addSource(evidence, { ...link, cited: true });
  const sources = [...evidence.sources].sort((a, b) => Number(Boolean(b.cited)) - Number(Boolean(a.cited))).slice(0, MAX_SOURCES);
  const images = evidence.images.slice(0, MAX_IMAGES);
  const data = evidence.data.slice(0, MAX_DATA).map((row) => ({ label: row.label.slice(0, 120), detail: row.detail.slice(0, 1500) }));
  return sources.length || images.length || data.length ? { sources, images, data } : undefined;
}
