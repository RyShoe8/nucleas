/**
 * Turns whatever a person exports from a logged-in browser (a Playwright storageState, or a plain cookie
 * list) into the small set of cookies that belong to one site. Cookies for other sites are dropped, so a
 * pasted browser export cannot smuggle in sessions for anything else.
 */

export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds; -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

const SAME_SITE: Record<string, SessionCookie['sameSite']> = { strict: 'Strict', lax: 'Lax', none: 'None', no_restriction: 'None', unspecified: 'Lax' };

export function domainMatches(cookieDomain: string, host: string): boolean {
  const d = cookieDomain.trim().toLowerCase().replace(/^\./, '');
  const h = host.toLowerCase();
  return Boolean(d) && (h === d || h.endsWith(`.${d}`));
}

export function sanitizeSessionCookies(raw: unknown, baseUrl: string): { cookies: SessionCookie[]; expiresAt: Date | null } {
  const host = new URL(baseUrl).hostname;
  const list: unknown = Array.isArray(raw) ? raw : (raw as { cookies?: unknown } | null)?.cookies;
  if (!Array.isArray(list)) throw new Error('Expected the cookies from a logged-in browser (a Playwright storageState or a cookie list).');
  const cookies: SessionCookie[] = [];
  let size = 0;
  for (const item of list.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const name = typeof c.name === 'string' ? c.name : '';
    const value = typeof c.value === 'string' ? c.value : '';
    const domain = typeof c.domain === 'string' ? c.domain : host;
    if (!name || !domainMatches(domain, host)) continue;
    const expiresRaw = Number(c.expires ?? c.expirationDate ?? -1);
    const cookie: SessionCookie = {
      name: name.slice(0, 200),
      value: value.slice(0, 4000),
      domain,
      path: typeof c.path === 'string' && c.path.startsWith('/') ? c.path.slice(0, 200) : '/',
      expires: Number.isFinite(expiresRaw) && expiresRaw > 0 ? Math.floor(expiresRaw) : -1,
      httpOnly: c.httpOnly === true,
      secure: c.secure !== false,
      sameSite: SAME_SITE[String(c.sameSite ?? 'lax').toLowerCase()] ?? 'Lax',
    };
    size += cookie.name.length + cookie.value.length + cookie.domain.length + 40;
    if (size > 30_000) break;
    cookies.push(cookie);
    if (cookies.length >= 60) break;
  }
  if (!cookies.length) throw new Error(`None of those cookies belong to ${host}. Log in to that site and export again.`);
  const now = Date.now() / 1000;
  const expiries = cookies.map((c) => c.expires).filter((e) => e > now);
  return { cookies, expiresAt: expiries.length ? new Date(Math.min(...expiries) * 1000) : null };
}
