/**
 * Keyword ideas from Google's autocomplete: what people actually type after a seed phrase. Free, but an unofficial
 * endpoint Google can change or rate-limit, so every request is paced, a failed one is skipped (and counted), and the
 * caller caches the whole answer for weeks. Autocomplete has no search volumes; it shows what is searched, not how much.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const ENDPOINT = 'https://suggestqueries.google.com/complete/search';
const QUESTION_WORDS = ['how', 'what', 'why', 'which', 'where', 'when', 'who', 'is', 'can', 'does', 'best'];
const JOINERS = ['vs', 'for', 'with', 'without', 'or', 'near', 'like'];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const MAX_IDEAS = 400;
const CONCURRENCY = 3;
const PAUSE_MS = 120;
const TIMEOUT_MS = 6000;

export type KeywordIdea = { keyword: string; from: string };
export type KeywordIdeasOutput = {
  seed: string;
  country: string;
  language: string;
  ideas: KeywordIdea[];
  /** Ideas phrased as questions, often the best H2s or FAQ entries. */
  questions: string[];
  requests: number;
  failedRequests: number;
};

/** The phrasings asked for one seed: the seed alone, question words before it, joiners and a–z after it. */
export function expansionsFor(seed: string, expand: boolean): { query: string; from: string }[] {
  const base = [{ query: seed, from: 'seed' }];
  if (!expand) return base;
  return [
    ...base,
    ...QUESTION_WORDS.map((w) => ({ query: `${w} ${seed}`, from: `"${w} …"` })),
    ...JOINERS.map((w) => ({ query: `${seed} ${w}`, from: `"… ${w}"` })),
    ...LETTERS.map((l) => ({ query: `${seed} ${l}`, from: `"… ${l}"` })),
  ];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function suggest(query: string, country: string, language: string, fetchImpl: FetchLike): Promise<string[]> {
  const url = `${ENDPOINT}?client=firefox&ie=utf-8&oe=utf-8&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(country)}&q=${encodeURIComponent(query)}`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error', cache: 'no-store' });
  if (!res.ok) throw new Error(`Autocomplete returned ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body) || !Array.isArray(body[1])) throw new Error('Autocomplete sent an unexpected answer');
  return (body[1] as unknown[]).filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 200));
}

export async function keywordIdeas(
  input: { seed: string; country?: string; language?: string; expand?: boolean },
  options: { fetchImpl?: FetchLike; pauseMs?: number } = {}
): Promise<KeywordIdeasOutput> {
  const seed = normalize(input.seed).slice(0, 120);
  if (seed.length < 2) throw new Error('Give a seed keyword of at least two characters.');
  const country = (input.country ?? 'us').toLowerCase().slice(0, 2);
  const language = (input.language ?? 'en').toLowerCase().slice(0, 5);
  const fetchImpl = options.fetchImpl ?? fetch;
  const pause = options.pauseMs ?? PAUSE_MS;
  const queue = expansionsFor(seed, input.expand !== false);
  const seen = new Map<string, KeywordIdea>();
  let failed = 0;

  // Paced and capped so the free endpoint is never hammered.
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const item = queue[next++];
      try {
        for (const keyword of await suggest(item.query, country, language, fetchImpl)) {
          const key = normalize(keyword);
          if (key && key !== seed && !seen.has(key)) seen.set(key, { keyword: key, from: item.from });
        }
      } catch {
        failed += 1;
      }
      if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  if (failed === queue.length) throw new Error('Google autocomplete did not answer. Try again later.');

  const ideas = [...seen.values()].slice(0, MAX_IDEAS);
  const questionStart = new RegExp(`^(${QUESTION_WORDS.filter((w) => w !== 'best').join('|')})\\b`);
  return {
    seed,
    country,
    language,
    ideas,
    questions: ideas.map((i) => i.keyword).filter((k) => questionStart.test(k) || k.endsWith('?')),
    requests: queue.length,
    failedRequests: failed,
  };
}
