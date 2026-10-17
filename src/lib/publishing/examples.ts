import type { PublishPlatform } from './config';
import { fetchPublicText, type FetchLike } from './fetchPublic';

/**
 * Reads an example post by its link so its structure can shape new drafts. Bluesky and Reddit expose
 * posts publicly; Facebook share links cannot be read without a browser, so the person pastes that one.
 */

export type ExampleRead = { ok: true; text: string } | { ok: false; error: string };

export function blueskyPostRef(url: string): { handle: string; rkey: string } | null {
  try {
    const parsed = new URL(url);
    if (!/^(?:www\.)?bsky\.app$/i.test(parsed.hostname)) return null;
    const match = /^\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)/.exec(parsed.pathname);
    return match ? { handle: decodeURIComponent(match[1]!), rkey: match[2]! } : null;
  } catch {
    return null;
  }
}

export function redditJsonUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)reddit\.com$/i.test(parsed.hostname) || !/\/comments\//.test(parsed.pathname)) return null;
    return `https://www.reddit.com${parsed.pathname.replace(/\/$/, '')}.json?raw_json=1`;
  } catch {
    return null;
  }
}

/** A Reddit post as an example: title, then body, then the link it shares. */
export function redditExampleText(listing: unknown): string | null {
  const post = (listing as { data?: { children?: { data?: Record<string, unknown> }[] } }[] | null)?.[0]?.data?.children?.[0]?.data;
  if (!post || typeof post.title !== 'string') return null;
  const body = typeof post.selftext === 'string' ? post.selftext.trim() : '';
  const link = typeof post.url === 'string' && !/reddit\.com\/r\/.+\/comments\//.test(post.url) ? post.url : '';
  return [`Title: ${post.title}`, body, link ? `Link: ${link}` : ''].filter(Boolean).join('\n\n');
}

async function json(url: string, fetcher?: FetchLike): Promise<unknown> {
  const res = await fetchPublicText(url, { accept: 'application/json', maxBytes: 2_000_000, fetcher });
  return JSON.parse(res.text);
}

export async function readExamplePost(platform: PublishPlatform, url: string, fetcher?: FetchLike): Promise<ExampleRead> {
  try {
    if (platform === 'bluesky') {
      const ref = blueskyPostRef(url);
      if (!ref) return { ok: false, error: 'That is not a Bluesky post link.' };
      const did = ref.handle.startsWith('did:')
        ? ref.handle
        : ((await json(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(ref.handle)}`, fetcher)) as { did?: string }).did;
      if (!did) return { ok: false, error: 'Bluesky did not recognize that account.' };
      const thread = (await json(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=0&uri=${encodeURIComponent(`at://${did}/app.bsky.feed.post/${ref.rkey}`)}`, fetcher)) as {
        thread?: { post?: { record?: { text?: string }; embed?: { external?: { title?: string; uri?: string } } } };
      };
      const post = thread.thread?.post;
      if (!post?.record?.text) return { ok: false, error: 'That Bluesky post could not be read.' };
      const card = post.embed?.external;
      return { ok: true, text: [post.record.text, card?.uri ? `[Link card: ${card.title ?? ''} ${card.uri}]` : ''].filter(Boolean).join('\n\n') };
    }
    if (platform === 'reddit') {
      const api = redditJsonUrl(url);
      if (!api) return { ok: false, error: 'That is not a Reddit post link.' };
      const text = redditExampleText(await json(api, fetcher));
      return text ? { ok: true, text } : { ok: false, error: 'That Reddit post could not be read.' };
    }
    return { ok: false, error: 'Facebook posts cannot be read from a link. Paste the post text instead.' };
  } catch {
    return { ok: false, error: `The ${platform === 'reddit' ? 'Reddit' : 'Bluesky'} post could not be read. Paste its text instead.` };
  }
}
