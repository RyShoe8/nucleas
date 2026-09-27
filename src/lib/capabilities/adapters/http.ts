import { CapabilityError, type CapabilityRunContext } from '../types';

const TIMEOUT_MS = 20_000;

/** JSON request with provider-neutral error mapping. Never includes credentials in error text. */
export async function providerJson<T>(
  ctx: CapabilityRunContext,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string } ,
  providerName: string
): Promise<T> {
  let res: Response;
  try {
    res = await ctx.fetch(url, {
      method: init.method ?? 'GET',
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new CapabilityError('failed', `${providerName} did not respond.`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.ok) return body as T;

  const flat = JSON.stringify(body ?? '').slice(0, 300);
  if (/insufficient plan/i.test(flat)) throw new CapabilityError('plan_limited', `${providerName} plan does not include this data.`);
  if (res.status === 401) throw new CapabilityError('needs_reauth', `${providerName} rejected the saved credential. Reconnect it.`);
  if (res.status === 403) throw new CapabilityError('needs_reauth', `${providerName} credential lacks permission for this. Check its scopes.`);
  if (res.status === 429) throw new CapabilityError('failed', `${providerName} rate limit reached. Try again shortly.`);
  throw new CapabilityError('failed', `${providerName} returned ${res.status}.`);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive date range defaulting to the last N full days (UTC). */
export function defaultRange(days: number, now = new Date()): { startDate: string; endDate: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (days - 1));
  return { startDate: isoDate(start), endDate: isoDate(end) };
}
