import 'server-only';
import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { createInstallationOctokit } from '@/lib/ai/githubAppClient';

export const sourceSchema = z.object({ id: z.string().max(300), title: z.string().max(300), url: z.string().url().max(2000), description: z.string().max(8000) });
export type Source = z.infer<typeof sourceSchema>;
const baseline = z.object({ publishedAt: z.string().datetime({ offset: true }).nullable(), coverageEnd: z.string().datetime({ offset: true }).nullish(), coveredIds: z.array(z.string()).default([]), slug: z.string().min(1), url: z.string().url().optional() });
const fact = z.union([z.string().max(1000), z.array(z.string().max(300)).max(20)]);
export const siteSchema = z.object({ games: z.array(z.object({ id: z.string().regex(/^[a-f\d]{24}$/i), slug: z.string(), title: z.string().trim().min(1).max(300), url: z.string().url(), publishedAt: z.string().datetime({ offset: true }), description: z.string().max(8000).optional(), longDescription: z.string().max(16000).nullish(), tagline: z.string().max(1000).optional(), features: z.array(z.string().max(1000)).max(50).optional(), genres: z.array(z.string().max(300)).max(30).optional(), maxPlayers: z.number().nullish(), browserPlayable: z.boolean().optional(), priceType: z.enum(['FREE','PAID','PAID_BASE_GAME_REQUIRED']).optional(), access: z.object({ priceType: z.enum(['FREE','PAID','PAID_BASE_GAME_REQUIRED']).optional(), priceCents: z.number().nullish(), currency: z.string().max(10).nullish(), requiresPurchase: z.boolean().optional(), requiresBaseGame: z.boolean().optional(), baseGameSlug: z.string().max(300).nullish(), externalGameName: z.string().max(300).nullish() }).nullish(), platform: fact.optional(), platforms: fact.optional(), free: z.boolean().optional(), isFree: z.boolean().optional(), gameplay: fact.optional() })).max(2000), baseline: baseline.nullish(), lastRoundup: baseline.nullish(), previousRoundup: baseline.nullish(), limitations: z.array(z.string().max(2000)).max(30).default([]) });

export function endpointFor(domain?: string): string | null {
  if (!domain) return null;
  try {
    const u = new URL(domain.includes('://') ? domain : `https://${domain}`);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || u.pathname !== '/' || u.search || u.hash || isIP(u.hostname) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname) || /\.(localhost|local|internal|test)$/i.test(u.hostname)) return null;
    return `${u.origin}/api/integrations/nucleas/roundup`;
  } catch { return null; }
}
export function secretFor(companyId: string, endpoint: string | null): string | undefined {
  return process.env[`NUCLEAS_ROUNDUP_SECRET_${companyId.toUpperCase()}`]?.trim()
    || (endpoint && ['playbound.club', 'www.playbound.club', 'playbound.com', 'www.playbound.com'].includes(new URL(endpoint).hostname) ? process.env.NUCLEAS_ROUNDUP_SECRET?.trim() : undefined);
}
export function signature(secret: string, timestamp: string, method: string, endpoint: string, rawBody: string): string {
  const u = new URL(endpoint);
  return createHmac('sha256', secret).update(`${timestamp}.${method}.${u.pathname}${u.search}.${rawBody}`).digest('hex');
}
function publicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false; // Fail closed for IPv6, including mapped private IPv4.
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || a === 198);
}
export async function siteRequest(endpoint: string, secret: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const addresses = await lookup(new URL(endpoint).hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Company domain must resolve only to public IPv4 addresses.');
  const raw = body === undefined ? '' : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(endpoint, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000), headers: { 'content-type': 'application/json', 'x-nucleas-timestamp': timestamp, 'x-nucleas-signature': signature(secret, timestamp, method, endpoint, raw) }, ...(method === 'POST' ? { body: raw } : {}) });
  if (!response.ok) throw new Error(`Site endpoint returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('Site response exceeds source limit.');
  return JSON.parse(text);
}
export const publicWork = (text: string) => !/\b(internal|ci|chore|refactor|dependabot|dependency|dependencies|build pipeline|test-only|admin-only|lint|devops|deployment)\b/i.test(text);
export function playerNotes(text: string): string {
  return text.split('\n').filter(publicWork).filter(line => {
    const value = line.replace(/[#*`_\-\s]/g, '').trim();
    return value.length >= 12 && !/^(what'?snew|changelog|release notes|full changelog|https?:\/\/|contributors|v?\d+\.\d+)/i.test(line.replace(/^[#*\s-]+/, ''));
  }).join('\n').trim();
}
export async function releaseSources(binding: { owner: string; repo: string; installationId?: string | null }, start: Date, end: Date): Promise<Source[]> {
  if (!binding.installationId) throw new Error(`GitHub installation missing for ${binding.owner}/${binding.repo}.`);
  const client = createInstallationOctokit(binding.installationId);
  const args = { owner: binding.owner, repo: binding.repo };
  const releases = [];
  // Explicit bound; fail rather than silently advance coverage over truncated releases.
  for (let page = 1; page <= 5; page++) {
    const { data } = await client.repos.listReleases({ ...args, per_page: 100, page, request: { timeout: 15000 } });
    releases.push(...data);
    if (data.length < 100) break;
    if (page === 5) throw new Error('Release history exceeds bounded source limit.');
  }
  const published = releases.filter(r => !r.draft && !r.prerelease && r.published_at).sort((a, b) => Date.parse(a.published_at!) - Date.parse(b.published_at!));
  const result: Source[] = [];
  for (let i = 0; i < published.length; i++) {
    const r = published[i];
    const date = new Date(r.published_at!);
    if (date < start || date >= end) continue;
    let notes = playerNotes(r.body ?? '').slice(0, 6000);
    if (notes.trim().length < 100 && i > 0) {
      const { data } = await client.repos.compareCommitsWithBasehead({ ...args, basehead: `${published[i - 1].tag_name}...${r.tag_name}`, per_page: 50, request: { timeout: 15000 } });
      // Only metadata inside this released tag range; never compare with HEAD.
      notes += '\n' + playerNotes(data.commits.slice(0, 50).map(c => c.commit.message.split('\n')[0]).join('\n'));
    }
    if (!notes.trim() || !publicWork(r.name ?? r.tag_name)) continue;
    result.push({ id: `github:${binding.owner}/${binding.repo}:${r.id}`, title: (r.name || r.tag_name).slice(0, 300), url: r.html_url, description: notes.slice(0, 8000) });
    if (result.length > 50) throw new Error('Too many releases for one roundup.');
  }
  return result;
}
