type CrawlEvidence = { url: string; title: string; description: string; h1: string[]; routePattern: string };

export type PropertyAnalysis = {
  description: string;
  primaryKeywords: string[];
  demographicTarget: string;
  competitors: { name: string; domain: string; reason: string }[];
  sources: string[];
  model: string | null;
};

const STOP_WORDS = new Set('a an and are as at be by for from has have how in into is it its of on or our that the their this to we what when where which with you your'.split(' '));

function fallback(evidence: CrawlEvidence[], rootUrl: string): PropertyAnalysis {
  const homepage = evidence.find((page) => new URL(page.url).pathname === '/') ?? evidence[0];
  const words = evidence.flatMap((page) => `${page.title} ${page.description} ${page.h1.join(' ')}`.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []);
  const counts = new Map<string, number>();
  for (const word of words) if (!STOP_WORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const primaryKeywords = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word]) => word);
  return {
    description: homepage?.description || homepage?.title || `Public website at ${new URL(rootUrl).hostname}.`,
    primaryKeywords,
    demographicTarget: 'Not confidently established from deterministic page metadata alone.',
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

function cleanAnalysis(value: unknown, evidence: CrawlEvidence[], rootUrl: string, model: string): PropertyAnalysis {
  const base = fallback(evidence, rootUrl); const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const list = (input: unknown, max: number) => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 200)).slice(0, max) : [];
  const competitors = Array.isArray(row.competitors) ? row.competitors.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>; const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''; const domain = typeof candidate.domain === 'string' ? candidate.domain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') : ''; const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : '';
    return name && domain && reason ? [{ name: name.slice(0, 160), domain: domain.slice(0, 253), reason: reason.slice(0, 500) }] : [];
  }).slice(0, 10) : [];
  return {
    description: typeof row.description === 'string' && row.description.trim() ? row.description.trim().slice(0, 2_000) : base.description,
    primaryKeywords: list(row.primaryKeywords, 20).length ? list(row.primaryKeywords, 20) : base.primaryKeywords,
    demographicTarget: typeof row.demographicTarget === 'string' && row.demographicTarget.trim() ? row.demographicTarget.trim().slice(0, 2_000) : base.demographicTarget,
    competitors,
    sources: list(row.sources, 30).filter((source) => evidence.some((page) => page.url === source)),
    model,
  };
}

/** Grounded synthesis after crawling. Failure degrades to extracted metadata; it never discards a crawl. */
export async function analyzeProperty(evidence: CrawlEvidence[], rootUrl: string): Promise<PropertyAnalysis> {
  const baseline = fallback(evidence, rootUrl);
  const endpoint = process.env.NUCLEAS_AI_REMOTE_ENDPOINT?.trim(); const token = process.env.NUCLEAS_AI_REMOTE_BEARER_TOKEN?.trim(); const model = process.env.NUCLEAS_AI_REMOTE_MODEL?.trim();
  if (!endpoint || !token || !model || !evidence.length) return baseline;
  const representative = [...evidence]
    .sort((a, b) => (new URL(a.url).pathname === '/' ? -1 : new URL(b.url).pathname === '/' ? 1 : a.routePattern.localeCompare(b.routePattern)))
    .filter((page, index, rows) => index === 0 || page.routePattern !== rows[index - 1]?.routePattern)
    .slice(0, 40)
    .map((page) => ({ url: page.url, routePattern: page.routePattern, title: page.title.slice(0, 200), description: page.description.slice(0, 300), h1: page.h1.slice(0, 3) }));
  const messages = [
    { role: 'system', content: 'You analyze a website from verified first-party crawl evidence. Return one JSON object only. Never infer children, education, healthcare, finance, geography, or another audience unless the evidence says so. Description, keywords, and demographic must be grounded in the supplied pages. List at most 10 genuine direct search/product competitors; omit uncertain candidates instead of inventing them. sources may contain only exact supplied URLs.' },
    { role: 'user', content: JSON.stringify({ property: rootUrl, evidence: representative, output: { description: 'specific property description', primaryKeywords: ['specific search topic'], demographicTarget: 'specific audience and intent, with uncertainty where needed', competitors: [{ name: 'competitor', domain: 'example.com', reason: 'why it directly competes' }], sources: ['exact evidence URL'] } }) },
  ];
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 2_000 }) });
      if (!response.ok) return baseline;
      const payload = await response.json() as { model?: unknown; choices?: { message?: { content?: unknown } }[] };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return baseline;
      return cleanAnalysis(jsonObject(content), evidence, rootUrl, typeof payload.model === 'string' ? payload.model : model);
    } finally { clearTimeout(timer); }
  } catch { return baseline; }
}
