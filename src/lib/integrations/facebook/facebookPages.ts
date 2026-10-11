import { FACEBOOK_GRAPH } from '@/lib/integrations/facebook/facebookOAuth';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FacebookPage {
  id: string;
  name: string;
  /** Page access token. Secret: store it sealed, never return or log it. */
  token: string;
}

const TIMEOUT_MS = 15_000;

async function graph<T>(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<T | null> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

function form(values: Record<string, string>): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) };
}

/**
 * Turns a login code into the Pages the person chose to share. The app secret and every token travel in
 * POST bodies or headers, never in URLs. Page tokens made from a long-lived user token do not expire.
 */
export async function exchangeFacebookPages(
  input: { code: string; redirectUri: string; appId: string; appSecret: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; pages: FacebookPage[] } | { ok: false; error: string }> {
  const short = await graph<{ access_token?: string }>(
    fetchImpl,
    `${FACEBOOK_GRAPH}/oauth/access_token`,
    form({ client_id: input.appId, client_secret: input.appSecret, redirect_uri: input.redirectUri, code: input.code })
  );
  if (!short?.access_token) return { ok: false, error: 'Facebook did not accept the sign-in. Please try again.' };

  const long = await graph<{ access_token?: string }>(
    fetchImpl,
    `${FACEBOOK_GRAPH}/oauth/access_token`,
    form({ grant_type: 'fb_exchange_token', client_id: input.appId, client_secret: input.appSecret, fb_exchange_token: short.access_token })
  );
  if (!long?.access_token) return { ok: false, error: 'Facebook did not grant a lasting token. Please try again.' };

  const accounts = await graph<{ data?: { id?: string; name?: string; access_token?: string }[] }>(
    fetchImpl,
    `${FACEBOOK_GRAPH}/me/accounts?fields=id,name,access_token&limit=100`,
    { headers: { authorization: `Bearer ${long.access_token}`, accept: 'application/json' } }
  );
  const pages = (accounts?.data ?? [])
    .filter((p): p is { id: string; name: string; access_token: string } => Boolean(p.id && p.name && p.access_token))
    .map((p) => ({ id: p.id, name: p.name, token: p.access_token }));
  if (!pages.length) return { ok: false, error: 'No Facebook Pages were shared. Log in again and choose the company Page when Facebook asks.' };
  return { ok: true, pages };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The only Page, or the one whose name matches the company; otherwise a message telling the person what to do. */
export function pickFacebookPage(pages: FacebookPage[], companyName: string): { ok: true; page: FacebookPage } | { ok: false; error: string } {
  if (pages.length === 1) return { ok: true, page: pages[0] };
  const wanted = normalize(companyName);
  const exact = pages.filter((p) => normalize(p.name) === wanted);
  const matches = exact.length ? exact : pages.filter((p) => wanted && (normalize(p.name).includes(wanted) || wanted.includes(normalize(p.name))));
  if (matches.length === 1) return { ok: true, page: matches[0] };
  return { ok: false, error: `Several Pages were shared (${pages.map((p) => p.name).slice(0, 5).join(', ')}). Log in again and choose only the company's Page.` };
}
