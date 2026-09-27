import { CapabilityError, type CapabilityRunContext } from '../types';
import { providerJson, isoDate } from './http';

const BASE = 'https://api.ahrefs.com/v3';

type AhrefsProject = { project_id: string; project_name: string; url: string; mode: string };

function headers(ctx: CapabilityRunContext) {
  return { authorization: `Bearer ${ctx.access.credential}` };
}

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export async function listAhrefsProjects(ctx: CapabilityRunContext): Promise<AhrefsProject[]> {
  const res = await providerJson<{ projects?: AhrefsProject[] }>(ctx, `${BASE}/management/projects`, { headers: headers(ctx) }, 'Ahrefs');
  return res.projects ?? [];
}

export function findProjectForDomain(projects: AhrefsProject[], domain: string): AhrefsProject | undefined {
  return projects.find((p) => hostOf(p.url) === domain);
}

/** Idempotent: returns the existing project for the domain instead of creating a duplicate. Free (no API units). */
export async function ensureAhrefsProject(
  ctx: CapabilityRunContext,
  input: { domain: string; name: string }
): Promise<{ project: AhrefsProject; created: boolean }> {
  const existing = findProjectForDomain(await listAhrefsProjects(ctx), input.domain);
  if (existing) return { project: existing, created: false };

  const res = await providerJson<{ projects?: AhrefsProject[] } & Partial<AhrefsProject>>(
    ctx,
    `${BASE}/management/projects`,
    {
      method: 'POST',
      headers: headers(ctx),
      body: JSON.stringify({ project_name: input.name, url: `https://${input.domain}/`, mode: 'subdomains', protocol: 'both', access: 'private' }),
    },
    'Ahrefs'
  );
  const created = res.projects?.find((p) => hostOf(p.url) === input.domain) ?? (res.project_id ? (res as AhrefsProject) : undefined);
  if (!created) throw new CapabilityError('failed', 'Ahrefs did not return the new project.');
  return { project: created, created: true };
}

export interface SeoOverviewOutput {
  domain: string;
  date: string;
  domainRating: number | null;
  ahrefsRank: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
  top3Keywords: number | null;
  trafficValueUsd: number | null;
}

export async function ahrefsOverview(ctx: CapabilityRunContext, domain: string, now = new Date()): Promise<SeoOverviewOutput> {
  const date = isoDate(now);
  const target = encodeURIComponent(domain);
  const dr = await providerJson<{ domain_rating?: { domain_rating?: number; ahrefs_rank?: number | null } }>(
    ctx,
    `${BASE}/site-explorer/domain-rating?target=${target}&date=${date}`,
    { headers: headers(ctx) },
    'Ahrefs'
  );
  const m = await providerJson<{ metrics?: { org_traffic?: number; org_keywords?: number; org_keywords_1_3?: number; org_cost?: number | null } }>(
    ctx,
    `${BASE}/site-explorer/metrics?target=${target}&date=${date}&mode=subdomains`,
    { headers: headers(ctx) },
    'Ahrefs'
  );
  return {
    domain,
    date,
    domainRating: dr.domain_rating?.domain_rating ?? null,
    ahrefsRank: dr.domain_rating?.ahrefs_rank ?? null,
    organicTraffic: m.metrics?.org_traffic ?? null,
    organicKeywords: m.metrics?.org_keywords ?? null,
    top3Keywords: m.metrics?.org_keywords_1_3 ?? null,
    trafficValueUsd: m.metrics?.org_cost != null ? Math.round(m.metrics.org_cost / 100) : null,
  };
}
