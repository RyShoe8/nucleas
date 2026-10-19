import { FACEBOOK_GRAPH } from '@/lib/integrations/facebook/facebookOAuth';
import { fetchPublic, type FetchLike } from './fetchPublic';

/**
 * Posting to the platforms that have an API. Each returns the live post's address, or throws a
 * PublishError that says whether a person has to reconnect, grant a permission, or just try again.
 */

export type PublishErrorCode = 'needs_reauth' | 'needs_permission' | 'rejected' | 'unreachable';

export class PublishError extends Error {
  constructor(readonly code: PublishErrorCode, message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

export interface PostInput {
  text: string;
  link: string | null;
  linkTitle?: string;
  linkDescription?: string;
  imageUrl?: string | null;
}

const TIMEOUT_MS = 20_000;

// ---------- Bluesky ----------

type Facet = { index: { byteStart: number; byteEnd: number }; features: ({ $type: 'app.bsky.richtext.facet#link'; uri: string } | { $type: 'app.bsky.richtext.facet#tag'; tag: string })[] };

/** Links and hashtags in post text as Bluesky facets (byte offsets in UTF-8), so they are clickable. */
export function blueskyFacets(text: string): Facet[] {
  const encoder = new TextEncoder();
  const byteAt = (index: number) => encoder.encode(text.slice(0, index)).length;
  const facets: Facet[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g)) {
    const start = match.index!;
    facets.push({ index: { byteStart: byteAt(start), byteEnd: byteAt(start + match[0].length) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }] });
  }
  for (const match of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const start = match.index! + match[1]!.length;
    if (/^\d+$/.test(match[2]!)) continue;
    facets.push({ index: { byteStart: byteAt(start), byteEnd: byteAt(start + 1 + match[2]!.length) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: match[2]! }] });
  }
  return facets;
}

export function splitBlueskyCredential(credential: string): { identifier: string; password: string } {
  const split = credential.indexOf(':');
  if (split <= 0) throw new PublishError('needs_reauth', 'The Bluesky connection is not set up as handle:app-password. Reconnect it.');
  return { identifier: credential.slice(0, split).trim().replace(/^@/, ''), password: credential.slice(split + 1).trim() };
}

async function xrpc<T>(fetcher: FetchLike, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new PublishError('unreachable', 'Bluesky did not respond. It will be tried again.');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (res.status === 401 || body.error === 'AuthenticationRequired' || body.error === 'ExpiredToken' || body.error === 'InvalidToken') {
    throw new PublishError('needs_reauth', 'Bluesky rejected the app password. Reconnect Bluesky in the company’s integrations.');
  }
  if (!res.ok) {
    if (res.status >= 500 || res.status === 429) throw new PublishError('unreachable', `Bluesky returned ${res.status}. It will be tried again.`);
    throw new PublishError('rejected', `Bluesky refused the post${body.message ? `: ${body.message.slice(0, 200)}` : ` (${res.status})`}.`);
  }
  return body;
}

export async function publishToBluesky(credential: string, input: PostInput, fetcher: FetchLike = fetch): Promise<{ url: string }> {
  const { identifier, password } = splitBlueskyCredential(credential);
  const session = await xrpc<{ accessJwt: string; did: string; handle: string; didDoc?: { service?: { id?: string; serviceEndpoint?: string }[] } }>(fetcher, 'https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const pds = session.didDoc?.service?.find((s) => s.id === '#atproto_pds')?.serviceEndpoint?.replace(/\/$/, '') || 'https://bsky.social';
  const auth = { authorization: `Bearer ${session.accessJwt}` };

  let thumb: unknown;
  if (input.link && input.imageUrl) {
    // A card without its image is still a good post; an image Bluesky would refuse (over ~1 MB) is left off.
    const image = await fetchPublic(input.imageUrl, { accept: 'image/*', maxBytes: 950_000, fetcher }).catch(() => null);
    if (image && /^image\/(jpeg|png|webp|gif)$/.test(image.contentType)) {
      const uploaded = await xrpc<{ blob: unknown }>(fetcher, `${pds}/xrpc/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...auth, 'content-type': image.contentType }, body: image.bytes as BodyInit }).catch(() => null);
      thumb = uploaded?.blob;
    }
  }

  const facets = blueskyFacets(input.text);
  const record = {
    $type: 'app.bsky.feed.post',
    text: input.text,
    createdAt: new Date().toISOString(),
    langs: ['en'],
    ...(facets.length ? { facets } : {}),
    ...(input.link
      ? { embed: { $type: 'app.bsky.embed.external', external: { uri: input.link, title: (input.linkTitle ?? '').slice(0, 300), description: (input.linkDescription ?? '').slice(0, 1000), ...(thumb ? { thumb } : {}) } } }
      : {}),
  };
  const created = await xrpc<{ uri: string }>(fetcher, `${pds}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
  });
  const rkey = created.uri.split('/').pop();
  return { url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
}

// ---------- Facebook ----------

type GraphError = { error?: { code?: number; message?: string; error_subcode?: number } };

function facebookError(status: number, body: GraphError): PublishError {
  const code = body.error?.code;
  if (code === 190 || status === 401) return new PublishError('needs_reauth', 'Facebook rejected the Page token. Reconnect Facebook in the company’s integrations.');
  if (code === 200 || code === 10 || code === 3 || (code !== undefined && code >= 200 && code < 300)) {
    return new PublishError('needs_permission', 'The Facebook connection is not allowed to post. Reconnect Facebook and allow posting to the Page.');
  }
  if (status >= 500 || code === 1 || code === 2 || code === 4 || code === 17 || code === 32) return new PublishError('unreachable', 'Facebook is busy or rate-limited. It will be tried again.');
  return new PublishError('rejected', `Facebook refused the post${body.error?.message ? `: ${body.error.message.slice(0, 200)}` : ` (${status})`}.`);
}

/** A Facebook post with the cover image shown large: a photo post whose caption carries the link. */
async function publishFacebookPhoto(token: string, input: PostInput & { imageUrl: string }, fetcher: FetchLike): Promise<{ url: string } | null> {
  const caption = input.link && !input.text.includes(input.link) ? `${input.text}

${input.link}` : input.text;
  let res: Response;
  try {
    res = await fetcher(`${FACEBOOK_GRAPH}/me/photos`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ url: input.imageUrl, caption, published: 'true' }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PublishError('unreachable', 'Facebook did not respond. It will be tried again.');
  }
  const body = (await res.json().catch(() => ({}))) as GraphError & { id?: string; post_id?: string };
  if (res.ok && (body.post_id || body.id)) return { url: `https://www.facebook.com/${body.post_id ?? body.id}` };
  const error = facebookError(res.status, body);
  // Permission, token and busy-server problems apply to any post; only an image Facebook would not take falls back to a link post.
  if (error.code !== 'rejected') throw error;
  return null;
}

export async function publishToFacebook(token: string, input: PostInput, fetcher: FetchLike = fetch): Promise<{ url: string }> {
  if (input.imageUrl) {
    const photo = await publishFacebookPhoto(token, { ...input, imageUrl: input.imageUrl }, fetcher);
    if (photo) return photo;
  }
  const form = new URLSearchParams({ message: input.text });
  if (input.link) form.set('link', input.link);
  let res: Response;
  try {
    res = await fetcher(`${FACEBOOK_GRAPH}/me/feed`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PublishError('unreachable', 'Facebook did not respond. It will be tried again.');
  }
  const body = (await res.json().catch(() => ({}))) as GraphError & { id?: string };
  if (!res.ok || !body.id) throw facebookError(res.status, body);
  return { url: `https://www.facebook.com/${body.id}` };
}

/**
 * Whether a Page token may post, from Facebook's own record of its permissions. Null when that cannot
 * be checked (the app's id and secret are not configured, or Facebook did not answer).
 */
export async function facebookTokenCanPost(token: string, fetcher: FetchLike = fetch): Promise<boolean | null> {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  try {
    const url = `${FACEBOOK_GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;
    const res = await fetcher(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { data?: { is_valid?: boolean; scopes?: string[] } } | null;
    if (!body?.data) return null;
    return Boolean(body.data.is_valid && body.data.scopes?.includes('pages_manage_posts'));
  } catch {
    return null;
  }
}
