import sanitizeHtml from 'sanitize-html';
import { isSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { fetchPublicText, type FetchLike } from './fetchPublic';

/** What a post can say and show about a page: its own title, summary, share image, other images and video. */
export interface PageFacts {
  title: string;
  description: string;
  text: string;
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
  const image = absolute(meta(html, 'og:image') ?? meta(html, 'og:image:url') ?? meta(html, 'twitter:image'), pageUrl);
  const body = /<main\b[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article\b[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
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
  return { title: title.slice(0, 500), description: description.slice(0, 2000), text, image, images, video };
}

export async function readPageFacts(url: string, fetcher?: FetchLike): Promise<PageFacts> {
  const res = await fetchPublicText(url, { accept: 'text/html,application/xhtml+xml', maxBytes: 3_000_000, fetcher });
  return extractPageFacts(res.text, res.url);
}
