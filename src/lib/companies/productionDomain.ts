export type ProductionDomainResult =
  | { ok: true; domain: string | null }
  | { ok: false; error: string };

/** Accept a hostname or a simple HTTP(S) URL and store one canonical production hostname. */
export function normalizeProductionDomain(value: unknown): ProductionDomainResult {
  if (typeof value !== 'string') return { ok: false, error: 'Production domain must be text.' };
  const raw = value.trim();
  if (!raw) return { ok: true, domain: null };
  if (raw.length > 500 || /[\r\n]/.test(raw)) return { ok: false, error: 'Production domain is invalid.' };

  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: 'Enter a domain such as example.com.' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: 'Production domain must use HTTP or HTTPS.' };
  if (url.username || url.password || url.port || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return { ok: false, error: 'Enter only the production domain, without a path, port, query, or login.' };
  }

  const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (domain.length > 253 || !domain.includes('.') || domain.includes(':') || /^\d+(?:\.\d+){3}$/.test(domain)) {
    return { ok: false, error: 'Enter a public domain such as example.com.' };
  }
  const labels = domain.split('.');
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
    return { ok: false, error: 'Enter a valid public domain such as example.com.' };
  }
  return { ok: true, domain };
}

/**
 * The one way two website addresses are compared: lowercase host, no protocol, port, path or
 * "www.", no trailing dot. "https://www.Example.com/" and "example.com" are the same site.
 */
export function siteKey(value: string | null | undefined): string {
  if (!value) return '';
  let host = value.trim().toLowerCase();
  if (!host) return '';
  if (host.startsWith('sc-domain:')) host = host.slice('sc-domain:'.length);
  try {
    host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
  } catch {
    host = host.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0];
  }
  return host.replace(/^www\./, '').replace(/\.$/, '');
}

/** True when two addresses are the same site, ignoring "www.", protocol and path. */
export function sameSite(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = siteKey(a);
  return Boolean(key) && key === siteKey(b);
}
