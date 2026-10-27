import sanitizeHtml from 'sanitize-html';
import { isSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { fetchPublicText, type FetchLike } from './fetchPublic';

/** What a post can say and show about a page: its own title, summary, cover image, other images and video. */
export interface PageFacts {
  title: string;
  description: string;
  text: string;
  /** Full editorial paragraphs, separate from shortened social metadata and navigation. */
  editorialText?: string;
  image: string | null;
  images: string[];
  video: string | null;
}

function meta(html: string, key: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const el = match[0];
    const name = /(?:property|name)=["']([^"']+)["']/i.exec(el)?.[1]?.toLowerCase();
    if (name !== key) continue;
    const content = /content=["']([^"']*)["']/i.exec(el)?.[1];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  return null;
}

/** Structured-data types whose `image` is the thing's own cover or key art (a game's cover, a product shot, an article's hero). */
const COVER_TYPES = /^(?:VideoGame|Game|SoftwareApplication|MobileApplication|WebApplication|Product|Book|Movie|Article|NewsArticle|BlogPosting)$/i;

function imageUrlOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return imageUrlOf(value[0]);
  if (value && typeof value === 'object') return imageUrlOf((value as { url?: unknown }).url ?? (value as { contentUrl?: unknown }).contentUrl);
  return null;
}

/**
 * The page's own cover image from its JSON-LD (for a game page, the game's cover art). A page's og:image is often a
 * generated share graphic rather than the cover, so this wins when the page declares one.
 */
export function structuredCoverImage(html: string, pageUrl: string): string | null {
  for (const block of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(block[1]!);
    } catch {
      continue;
    }
    const nodes: unknown[] = Array.isArray(data) ? data : (data as { '@graph'?: unknown[] })?.['@graph'] ?? [data];
    for (const node of nodes) {
      const type = (node as { '@type'?: unknown } | null)?.['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (!types.some((t) => typeof t === 'string' && COVER_TYPES.test(t))) continue;
      const url = absoluteUrl(imageUrlOf((node as { image?: unknown }).image), pageUrl);
      if (url && !/\.svg(\?|$)/i.test(url)) return url;
    }
  }
  return null;
}

function absoluteUrl(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base).toString();
    return isSafePublicHttpsUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function absolute(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base).toString();
    return isSafePublicHttpsUrl(url) ? url : null;
  } catch {
    return null;
  }
}

/** A YouTube or Vimeo embed as its watch link, so a post can point at the trailer. */
function watchLink(src: string): string | null {
  const youtube = /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,})/.exec(src)?.[1];
  if (youtube) return `https://www.youtube.com/watch?v=${youtube}`;
  const vimeo = /player\.vimeo\.com\/video\/(\d+)/.exec(src)?.[1];
  return vimeo ? `https://vimeo.com/${vimeo}` : null;
}

export function extractPageFacts(html: string, pageUrl: string): PageFacts {
  const title = meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim();
  const description = meta(html, 'og:description') ?? meta(html, 'description') ?? meta(html, 'twitter:description') ?? '';
  const image = structuredCoverImage(html, pageUrl) ?? absolute(meta(html, 'og:image') ?? meta(html, 'og:image:url') ?? meta(html, 'twitter:image'), pageUrl);
  const body = /<main\b[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article\b[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  const editorial: string[] = [];
  for (const section of body.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)) {
    const heading = decodeEntities(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(section[1])?.[1] ?? '').trim();
    if (!/^(about\b|overview\b|gameplay\b|how to play\b|why we picked|who it.?s for)/i.test(heading)) continue;
    for (const paragraph of section[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const value = decodeEntities(paragraph[1]).replace(/\s+/g, ' ').trim();
      if (value.length >= 40 && value.length <= 2000 && !editorial.includes(value)) editorial.push(value);
    }
  }
  const editorialText = editorial.slice(0, 3).join('\n\n');
  const images: string[] = [];
  for (const match of body.matchAll(/<img\b[^>]*>/gi)) {
    const el = match[0];
    const src = /\bsrc=["']([^"']+)["']/i.exec(el)?.[1];
    const url = absolute(src, pageUrl);
    if (!url || /\.svg(\?|$)/i.test(url) || /logo|icon|avatar|sprite|pixel/i.test(url) || url === image || images.includes(url)) continue;
    images.push(url);
    if (images.length >= 4) break;
  }
  let video = absolute(meta(html, 'og:video:secure_url') ?? meta(html, 'og:video:url') ?? meta(html, 'og:video'), pageUrl);
  video = video ? watchLink(video) ?? video : null;
  if (!video) {
    for (const match of body.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      video = watchLink(match[1]!);
      if (video) break;
    }
  }
  const text = sanitizeHtml(body.replace(/<(script|style|nav|header|footer|noscript)\b[\s\S]*?<\/\1>/gi, ' '), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
  return { title: title.slice(0, 500), description: description.slice(0, 2000), text: editorialText ? `${editorialText}\n\n${text}`.slice(0, 6000) : text, editorialText, image, images, video };
}

export async function readPageFacts(url: string, fetcher?: FetchLike): Promise<PageFacts> {
  const res = await fetchPublicText(url, { accept: 'text/html,application/xhtml+xml', maxBytes: 3_000_000, timeoutMs: 30_000, fetcher });
  return extractPageFacts(res.text, res.url);
}
