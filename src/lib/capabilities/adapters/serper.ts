import { siteKey } from '@/lib/companies/productionDomain';
import { CapabilityError, type CapabilityRunContext } from '../types';
import { providerJson } from './http';

/**
 * Live Google results for one search through Serper (serper.dev): the top organic results, "People also ask",
 * related searches and any answer box, plus where the company itself ranks. Each call spends one Serper credit, so the
 * capability caches identical searches for two weeks.
 */

export type SerpInput = { query: string; country: string; language: string; location?: string };

type SerperResponse = {
  organic?: { title?: string; link?: string; snippet?: string; position?: number; date?: string }[];
  peopleAlsoAsk?: { question?: string; snippet?: string; link?: string }[];
  relatedSearches?: { query?: string }[];
  answerBox?: { title?: string; answer?: string; snippet?: string; link?: string };
  knowledgeGraph?: { title?: string; type?: string; website?: string };
  topStories?: { title?: string; link?: string; source?: string }[];
  credits?: number;
};

export interface SerpOutput {
  query: string;
  country: string;
  language: string;
  location: string | null;
  organic: { position: number; title: string; url: string; domain: string; snippet: string; date: string | null }[];
  peopleAlsoAsk: { question: string; answerSource: string | null }[];
  relatedSearches: string[];
  answerBox: { text: string; source: string | null } | null;
  knowledgeGraph: { title: string; type: string | null } | null;
  topStories: { title: string; source: string | null }[];
  /** The company's best organic position for this search, or null when it is not in these results. */
  companyPosition: number | null;
  companyUrl: string | null;
}

function domainOf(link: string): string {
  try {
    return siteKey(new URL(link).hostname);
  } catch {
    return '';
  }
}

export async function serperSearch(ctx: CapabilityRunContext, input: SerpInput): Promise<SerpOutput> {
  const body = await providerJson<SerperResponse>(
    ctx,
    'https://google.serper.dev/search',
    {
      method: 'POST',
      headers: { 'x-api-key': ctx.access.credential },
      body: JSON.stringify({ q: input.query, gl: input.country, hl: input.language, num: 10, ...(input.location ? { location: input.location } : {}) }),
    },
    'Serper'
  );
  if (!body || !Array.isArray(body.organic)) throw new CapabilityError('failed', 'Serper sent no search results.');
  ctx.reportUnits(typeof body.credits === 'number' ? body.credits : 1);

  const organic = body.organic
    .filter((r) => typeof r.link === 'string' && typeof r.title === 'string')
    .map((r, i) => ({ position: r.position ?? i + 1, title: r.title!.slice(0, 300), url: r.link!.slice(0, 2000), domain: domainOf(r.link!), snippet: (r.snippet ?? '').slice(0, 400), date: r.date ?? null }));
  const own = siteKey(ctx.companyDomain);
  const mine = own ? organic.find((r) => r.domain === own || r.domain.endsWith(`.${own}`)) : undefined;
  const answer = body.answerBox?.answer ?? body.answerBox?.snippet;
  return {
    query: input.query,
    country: input.country,
    language: input.language,
    location: input.location ?? null,
    organic,
    peopleAlsoAsk: (body.peopleAlsoAsk ?? []).filter((q) => typeof q.question === 'string').map((q) => ({ question: q.question!.slice(0, 300), answerSource: q.link ? domainOf(q.link) || null : null })),
    relatedSearches: (body.relatedSearches ?? []).map((r) => r.query).filter((q): q is string => typeof q === 'string').map((q) => q.slice(0, 200)),
    answerBox: answer ? { text: answer.slice(0, 600), source: body.answerBox?.link ? domainOf(body.answerBox.link) || null : null } : null,
    knowledgeGraph: body.knowledgeGraph?.title ? { title: body.knowledgeGraph.title.slice(0, 200), type: body.knowledgeGraph.type ?? null } : null,
    topStories: (body.topStories ?? []).filter((s) => typeof s.title === 'string').slice(0, 6).map((s) => ({ title: s.title!.slice(0, 300), source: s.source ?? null })),
    companyPosition: mine?.position ?? null,
    companyUrl: mine?.url ?? null,
  };
}
