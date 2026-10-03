type CrawlEvidence = {
  url: string;
  title: string;
  description: string;
  h1: string[];
  h2?: string[];
  metaKeywords?: string[];
  routePattern: string;
};

type SearchEvidence = { title: string; url: string; snippet: string };

export type PropertyAnalysis = {
  description: string;
  primaryKeywords: string[];
  demographicTarget: string;
  competitors: { name: string; domain: string; reason: string }[];
  sources: string[];
  model: string | null;
};

const STOP_WORDS = new Set(`a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves`.split(/\s+/));
const GENERIC_WORDS = new Set('also best better click content discover find first friends get good great help home learn like make new one online page pages play playing read roughly see site start top use using view visit way website worth'.split(' '));
const WEAK_PHRASE_ENDINGS = new Set('affordable best better dedicated easy free great live new open simple strong top'.split(' '));

function tokens(value: string): string[] {
  return (value.toLowerCase().replace(/&(?:amp|nbsp);/g, ' ').match(/[a-z][a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
    .map((word) => word.replace(/^-|-$/g, ''));
}

function keywordCandidates(evidence: CrawlEvidence[], rootUrl: string): string[] {
  const brand = new URL(rootUrl).hostname.replace(/^www\./, '').split('.')[0] ?? '';
  const scores = new Map<string, { score: number; documents: Set<string>; authoritative: boolean }>();
  const add = (phrase: string, score: number, document: string, authoritative: boolean) => {
    const phraseWords = tokens(phrase);
    const contentWords = phraseWords.filter((word) => word.length > 2 && word !== brand && !STOP_WORDS.has(word) && !GENERIC_WORDS.has(word));
    if (contentWords.length < 2 || phraseWords.includes(brand) || STOP_WORDS.has(phraseWords[0]) || STOP_WORDS.has(phraseWords.at(-1) ?? '') || GENERIC_WORDS.has(phraseWords[0]) || GENERIC_WORDS.has(phraseWords.at(-1) ?? '') || WEAK_PHRASE_ENDINGS.has(phraseWords.at(-1) ?? '')) return;
    const normalized = phraseWords.join(' ');
    const current = scores.get(normalized) ?? { score: 0, documents: new Set<string>(), authoritative: false };
    current.score += score; current.documents.add(document); current.authoritative ||= authoritative; scores.set(normalized, current);
  };
  for (const page of evidence) {
    const depth = new URL(page.url).pathname.split('/').filter(Boolean).length;
    const depthFactor = depth <= 1 ? 1.5 : depth === 2 ? 1 : 0.65;
    const fields = [
      { value: page.title, weight: 5, authoritative: true },
      { value: page.description, weight: 4, authoritative: false },
      ...page.h1.map((value) => ({ value, weight: 5, authoritative: true })),
      ...(page.h2 ?? []).slice(0, 6).map((value) => ({ value, weight: 2, authoritative: depth <= 1 })),
      ...(page.metaKeywords ?? []).map((value) => ({ value, weight: 7, authoritative: true })),
    ];
    for (const field of fields) {
      const words = tokens(field.value);
      for (let size = 2; size <= 4; size += 1) {
        for (let index = 0; index <= words.length - size; index += 1) {
          add(words.slice(index, index + size).join(' '), field.weight * depthFactor * (size === 2 ? 1.1 : size === 3 ? 1.3 : 1.4), page.url, field.authoritative);
        }
      }
      if ((page.metaKeywords ?? []).includes(field.value)) add(field.value, field.weight * depthFactor * 1.5, page.url, true);
    }
  }
  const ranked = [...scores]
    .filter(([, value]) => value.documents.size >= Math.min(2, evidence.length) || value.authoritative)
    .map(([phrase, value]) => ({ phrase, score: value.score + Math.min(value.documents.size, 25) * 7 }))
    .sort((a, b) => b.score - a.score || b.phrase.split(' ').length - a.phrase.split(' ').length);
  const selected: string[] = [];
  for (const candidate of ranked) {
    if (selected.some((existing) => existing === candidate.phrase || existing.includes(candidate.phrase))) continue;
    selected.push(candidate.phrase);
    if (selected.length === 12) break;
  }
  return selected;
}

function demographicFromEvidence(evidence: CrawlEvidence[], keywords: string[]): string {
  const fields = evidence.flatMap((page) => [page.description, ...page.h1, ...(page.h2 ?? [])]).filter(Boolean);
  for (const field of fields) {
    const explicit = field.match(/(?:built|created|designed|developed|made|ideal|perfect|platform|products?|resources?|services?|software|tools?)\s+for\s+([^.!?;]{5,140})/i)?.[1]?.trim();
    if (explicit) return `People described by the site as ${explicit.replace(/\s+/g, ' ')}.`;
  }
  return keywords.length ? `People seeking ${keywords.slice(0, 4).join(', ')}.` : 'Not confidently established from the available first-party evidence.';
}

export function buildBaselineAnalysis(evidence: CrawlEvidence[], rootUrl: string): PropertyAnalysis {
  const homepage = evidence.find((page) => new URL(page.url).pathname === '/') ?? evidence[0];
  const primaryKeywords = keywordCandidates(evidence, rootUrl);
  return {
    description: homepage?.description || homepage?.title || `Public website at ${new URL(rootUrl).hostname}.`,
    primaryKeywords,
    demographicTarget: demographicFromEvidence(evidence, primaryKeywords),
    competitors: [],
    sources: evidence.slice(0, 10).map((page) => page.url),
    model: null,
  };
}

function jsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf('{'); const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Analysis did not return JSON.');
  return JSON.parse(fenced.slice(start, end + 1));
}

function cleanAnalysis(value: unknown, evidence: CrawlEvidence[], search: SearchEvidence[], rootUrl: string, model: string): PropertyAnalysis {
  const base = buildBaselineAnalysis(evidence, rootUrl); const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const list = (input: unknown, max: number) => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 200)).slice(0, max) : [];
  const modelKeywords = list(row.primaryKeywords, 20).filter((keyword) => {
    const brand = new URL(rootUrl).hostname.split('.')[0]?.toLowerCase() ?? '';
    const words = tokens(keyword).filter((word) => word.length > 2 && word !== brand && !STOP_WORDS.has(word) && !GENERIC_WORDS.has(word));
    return words.length >= 2;
  });
  const competitors = Array.isArray(row.competitors) ? row.competitors.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>; const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''; const domain = typeof candidate.domain === 'string' ? candidate.domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : ''; const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : '';
    const ownDomain = new URL(rootUrl).hostname.replace(/^www\./, '');
    return name && domain && reason && domain.replace(/^www\./, '') !== ownDomain ? [{ name: name.slice(0, 160), domain: domain.slice(0, 253), reason: reason.slice(0, 500) }] : [];
  }).slice(0, 10) : [];
  const allowedSources = new Set([...evidence.map((page) => page.url), ...search.map((item) => item.url)]);
  return {
    description: typeof row.description === 'string' && row.description.trim() ? row.description.trim().slice(0, 2_000) : base.description,
    primaryKeywords: modelKeywords.length ? modelKeywords : base.primaryKeywords,
    demographicTarget: typeof row.demographicTarget === 'string' && row.demographicTarget.trim() ? row.demographicTarget.trim().slice(0, 2_000) : base.demographicTarget,
    competitors,
    sources: list(row.sources, 30).filter((source) => allowedSources.has(source)),
    model,
  };
}

export function selectRepresentativeEvidence(evidence: CrawlEvidence[], limit = 60): CrawlEvidence[] {
  const scored = evidence.map((page, index) => {
    const path = new URL(page.url).pathname; const depth = path.split('/').filter(Boolean).length;
    const richness = Math.min(10, page.description.length / 40) + page.h1.length * 2 + Math.min(4, (page.h2 ?? []).length);
    return { page, index, score: (path === '/' ? 1000 : 0) + (depth <= 1 ? 100 : depth === 2 ? 30 : 0) + richness };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: CrawlEvidence[] = []; const routeCounts = new Map<string, number>();
  for (const { page } of scored) {
    const count = routeCounts.get(page.routePattern) ?? 0;
    if (count >= 3) continue;
    selected.push(page); routeCounts.set(page.routePattern, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

async function competitorResearch(rootUrl: string, keywords: string[], signal?: AbortSignal): Promise<SearchEvidence[]> {
  const base = process.env.SEARXNG_BASE_URL?.trim();
  if (!base) return [];
  const rootDomain = new URL(rootUrl).hostname.replace(/^www\./, '');
  const queries = [`${rootDomain} competitors alternatives`, `${keywords.slice(0, 5).join(' ')} competitors platforms`];
  const results: SearchEvidence[] = [];
  for (const query of queries) {
    try {
      const url = new URL('/search', base); url.searchParams.set('q', query); url.searchParams.set('format', 'json');
      const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const payload = await response.json() as { results?: { title?: unknown; url?: unknown; content?: unknown }[] };
      for (const item of payload.results?.slice(0, 12) ?? []) {
        if (typeof item.url !== 'string' || typeof item.title !== 'string') continue;
        let domain = ''; try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch { continue; }
        if (domain === rootDomain || domain.endsWith(`.${rootDomain}`)) continue;
        results.push({ title: item.title.slice(0, 240), url: item.url, snippet: typeof item.content === 'string' ? item.content.slice(0, 500) : '' });
      }
    } catch (error) { if (signal?.aborted) throw error; }
  }
  return [...new Map(results.map((item) => [item.url, item])).values()].slice(0, 20);
}

function analysisModelScore(model: string, configured: string): number {
  const name = model.toLowerCase();
  let score = model === configured ? 20 : 0;
  if (/gemma[-_/ ]?4/.test(name)) score += 70;
  else if (/qwen[-_/ ]?3/.test(name)) score += 60;
  else if (/qwen2\.5.*coder|coder.*qwen2\.5/.test(name)) score += 50;
  else if (/instruct|coder|chat/.test(name)) score += 30;
  if (/\bvl\b|vision|thinking|reasoning|image|audio/.test(name.replace(/[-_/]/g, ' '))) score -= 150;
  return score;
}

export function rankAnalysisModels(models: string[], configured: string): string[] {
  return [...new Set([configured, ...models].filter(Boolean))]
    .sort((a, b) => analysisModelScore(b, configured) - analysisModelScore(a, configured))
    .slice(0, 3);
}

async function availableAnalysisModels(endpoint: string, token: string, configured: string, signal: AbortSignal): Promise<string[]> {
  try {
    const url = new URL(endpoint); url.pathname = url.pathname.replace(/\/(?:chat\/completions|responses)\/?$/, '/models'); url.search = ''; url.hash = '';
    const response = await fetch(url, { redirect: 'error', signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!response.ok) return [configured];
    const payload = await response.json() as { data?: { id?: unknown }[] };
    return rankAnalysisModels((payload.data ?? []).flatMap((item) => typeof item.id === 'string' ? [item.id] : []), configured);
  } catch { return [configured]; }
}

/** Grounded synthesis after crawling. Failure degrades to useful extracted metadata; it never discards a crawl. */
export async function analyzeProperty(evidence: CrawlEvidence[], rootUrl: string, signal?: AbortSignal): Promise<PropertyAnalysis> {
  const baseline = buildBaselineAnalysis(evidence, rootUrl);
  const endpoint = process.env.NUCLEAS_AI_REMOTE_ENDPOINT?.trim(); const token = process.env.NUCLEAS_AI_REMOTE_BEARER_TOKEN?.trim(); const model = process.env.NUCLEAS_AI_REMOTE_MODEL?.trim();
  if (!endpoint || !token || !model || !evidence.length) return baseline;
  const representative = selectRepresentativeEvidence(evidence, 30).map((page) => ({ url: page.url, routePattern: page.routePattern, title: page.title.slice(0, 180), description: page.description.slice(0, 240), h1: page.h1.slice(0, 2), h2: (page.h2 ?? []).slice(0, 3), metaKeywords: (page.metaKeywords ?? []).slice(0, 6) }));
  const research = await competitorResearch(rootUrl, baseline.primaryKeywords, signal);
  const messages = [
    { role: 'system', content: 'You analyze a website from verified first-party crawl evidence plus labeled web-search results. Return one JSON object only. Identify the actual offering and audience; never infer children, education, healthcare, finance, geography, or another audience from a brand name. Keywords must be specific search topics, preferably meaningful 2-4 word phrases; reject generic isolated words. Identify at most 10 genuine direct product or search competitors only when a search result supports them. Do not list articles, directories, social networks, or unrelated sites merely because they rank. Every claim must be grounded in supplied evidence and sources may contain only exact supplied URLs.' },
    { role: 'user', content: JSON.stringify({ property: rootUrl, deterministicBaseline: baseline, firstPartyEvidence: representative, competitorSearchResults: research, output: { description: 'specific property description', primaryKeywords: ['specific multi-word search topic'], demographicTarget: 'specific audience and intent supported by first-party evidence', competitors: [{ name: 'competitor', domain: 'example.com', reason: 'specific overlap supported by search evidence' }], sources: ['exact supplied evidence URL'] } }) },
  ];
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const candidates = await availableAnalysisModels(endpoint, token, model, requestSignal);
      for (const candidate of candidates) {
        try {
          const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: requestSignal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: candidate, messages, temperature: 0.1, max_tokens: 1_800, response_format: { type: 'json_object' } }) });
          if (!response.ok) { console.warn(`[property-analysis] ${candidate} returned HTTP ${response.status}`); continue; }
          const payload = await response.json() as { model?: unknown; choices?: { finish_reason?: unknown; message?: { content?: unknown } }[] };
          const content = payload.choices?.[0]?.message?.content;
          if (typeof content !== 'string' || !content.trim()) { console.warn(`[property-analysis] ${candidate} returned no final text (${String(payload.choices?.[0]?.finish_reason ?? 'unknown')})`); continue; }
          return cleanAnalysis(jsonObject(content), evidence, research, rootUrl, typeof payload.model === 'string' ? payload.model : candidate);
        } catch (error) {
          if (signal?.aborted || controller.signal.aborted) throw error;
          console.warn(`[property-analysis] ${candidate} synthesis failed`, error instanceof Error ? error.message : 'unknown error');
        }
      }
      return baseline;
    } finally { clearTimeout(timer); }
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('[property-analysis] synthesis failed', error instanceof Error ? error.message : 'unknown error');
    return baseline;
  }
}
