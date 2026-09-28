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
