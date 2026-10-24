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

/** Production deployments, rather than arbitrary default-branch work, bound untagged platform updates. */
export async function deployedSources(binding: { owner: string; repo: string; installationId?: string | null }, start: Date, end: Date, client = createInstallationOctokit(binding.installationId ?? '')): Promise<Source[]> {
  if (!binding.installationId) throw new Error(`GitHub installation missing for ${binding.owner}/${binding.repo}.`);
  const args = { owner: binding.owner, repo: binding.repo };
  let latest: string | undefined;
  let statusReads = 0;
  for (let page = 1; page <= 10 && !latest; page++) {
    const { data } = await client.repos.listDeployments({ ...args, per_page: 100, page, request: { timeout: 15000 } });
    for (const deployment of data) {
      if (!/^production$/i.test(deployment.environment)) continue;
      const date = new Date(deployment.created_at);
      if (date >= end) continue;
      if (++statusReads > 20) throw new Error('Too many unconfirmed production deployments; coverage unchanged.');
      const statuses = await client.repos.listDeploymentStatuses({ ...args, deployment_id: deployment.id, per_page: 100, request: { timeout: 15000 } });
      // Inactive is a previously successful deployment superseded by a newer production deployment.
      const success = statuses.data.find(s => s.state === 'success');
      if (!success || !['success', 'inactive'].includes(statuses.data[0]?.state) || new Date(success.created_at) >= end) continue;
      if (date < start && new Date(success.created_at) < start) return [];
      latest = deployment.sha;
      break;
    }
    if (!data.length || data.length < 100) break;
    if (page === 10 && !latest) throw new Error('Production deployment history exceeds source limit; coverage unchanged.');
  }
  if (!latest) return [];
  const groups: Record<string, string[]> = { Added: [], Improved: [], Fixed: [] };
  const seen = new Set<string>();
  for (let page = 1; page <= 10; page++) {
    // Walk only ancestors of the confirmed deployment SHA. Date bounds also tolerate rewritten histories.
    const { data } = await client.repos.listCommits({ ...args, sha: latest, since: start.toISOString(), until: end.toISOString(), per_page: 100, page, request: { timeout: 15000 } });
    for (const commit of data) {
      const date = commit.commit.committer?.date;
      if (!date || new Date(date) < start || new Date(date) >= end) continue;
      const title = commit.commit.message.split('\n')[0].trim();
      if (!publicWork(title) || /\b(admin|catalog wave|catalog-scope|signed catalog|roundup|telemetry|analytics|smoke|fixtures?|cache key|bump|unsigned|runtime|seccomp|tmpfs|isolat(?:ion|ed)|acceptance|gate matrix|probe|diagnostic|record|pins?|adapter|resolver|registry|schema|sitemap|VPS|host agent|log each|port first|stored as|document)\b/i.test(title) || /^(merge\b|launcher\s+v?\d)/i.test(title)) continue;
      if (!/\b(add|added|enable|improve|improved|fix|fixed|repair|correct|restore|support|show|give|open|keep|speed|stop|start|offer)\b/i.test(title)) continue;
      const cleaned = title.replace(/\s*\[[^\]]*\]/g, '').replace(/^(feat|fix|perf)(\([^)]*\))?:\s*/i, '').trim();
      if (seen.has(cleaned.toLowerCase())) continue;
      seen.add(cleaned.toLowerCase());
      const category = /\b(fix|fixed|repair|correct|restore|stop|no longer)\b/i.test(title) ? 'Fixed' : /\b(add|added|enable|support)\b/i.test(title) ? 'Added' : 'Improved';
      groups[category].push(cleaned);
    }
    if (data.length < 100) break;
    if (page === 10) throw new Error('Production change range exceeds source limit; coverage unchanged.');
  }
  const url = `https://github.com/${binding.owner}/${binding.repo}/commits/${latest}/?since=${encodeURIComponent(start.toISOString())}&until=${encodeURIComponent(end.toISOString())}`;
  return Object.entries(groups).filter(([, notes]) => notes.length).map(([category, notes]) => ({
    id: `github:${binding.owner}/${binding.repo}:production:${latest}:${category.toLowerCase()}`,
    title: `Platform updates — ${category.toLowerCase()}`,
    url,
    description: `${category}:\n${notes.slice(0, 5).map(note => `- ${completeExcerpt(note, 350)}`).join('\n')}\nEvidence: up to five recent highlights per section from commits dated in this window and included in a successful production deployment. Commit dates are not individual feature deployment dates. Repository changes are not proof of launcher distribution. Do not claim a launcher version was released.`,
  }));
}

/** The length is a soft target: a complete sentence matters more than a character cap. */
export function completeExcerpt(text: string, limit = 300): string {
  const plain = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= limit) return plain;
  const ends = [...plain.matchAll(/[.!?](?:["'”’)])?(?=\s|$)/g)].filter(match => {
    const prefix = plain.slice(0, match.index + 1);
    return !/\b(?:Lt|Mr|Mrs|Ms|Dr|Prof|Capt|Sgt|Col|Gen|St|vs|etc|e\.g|i\.e)\.$/i.test(prefix)
      && !/\b[A-Z]\.$/.test(prefix);
  }).map(match => match.index + match[0].length);
  const boundary = ends.filter(end => end <= limit).at(-1) ?? ends[0];
  // A long first sentence or unpunctuated source is retained intact, never sliced into a fragment.
  return boundary ? plain.slice(0, boundary) : plain;
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
