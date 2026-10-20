import 'server-only';
import { webFetch } from '@/lib/ai/tools/webFetch';

export interface DeadPage {
  index: number;
  url: string;
  /** HTTP status, or 0 when the address is not a public HTTPS page at all. */
  status: number;
}

type Fetcher = (url: string) => Promise<unknown>;

/**
 * Recommended pages that do not exist. A model sometimes invents a plausible address (a GitHub topic that was never
 * created, a directory path that never existed). Only a definite "not found" counts: 404 and 410, or an address that
 * is not a public HTTPS page. Sites that block automated readers (403, 429), time out or fail are left alone, since
 * a person may still be able to open them.
 */
export async function deadOpportunityPages(urls: string[], fetcher: Fetcher = (url) => webFetch(url)): Promise<DeadPage[]> {
  const out: DeadPage[] = [];
  await Promise.all(
    urls.map(async (raw, index) => {
      const url = raw.trim();
      if (!url) return;
      try {
        await fetcher(url);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const status = /HTTP (\d{3})/.exec(message)?.[1];
        if (status === '404' || status === '410') out.push({ index, url, status: Number(status) });
        else if (/invalid url|only https|not allowed|private network/i.test(message)) out.push({ index, url, status: 0 });
      }
    })
  );
  return out.sort((a, b) => a.index - b.index);
}

export const deadPageProblem = (page: DeadPage) =>
  page.status === 0
    ? `${page.url} is not a public HTTPS page. Recommend only a real page you opened with a tool in this run.`
    : `${page.url} does not exist (HTTP ${page.status}). Recommend only a real page you opened with a tool in this run, never an address you expect to exist.`;
