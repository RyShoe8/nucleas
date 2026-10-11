export type SubredditResult =
  | { ok: true; subreddit: string | null }
  | { ok: false; error: string };

const NAME = /^[A-Za-z0-9_]{3,21}$/;
const REDDIT_HOST = /^(?:www\.|old\.|new\.|np\.|m\.)?reddit\.com$/i;

/** Accepts "r/name", "/r/name/", "name", or a reddit.com subreddit URL and returns the bare subreddit name. */
export function normalizeSubreddit(value: unknown): SubredditResult {
  if (typeof value !== 'string') return { ok: false, error: 'Subreddit must be text.' };
  const raw = value.trim();
  if (!raw) return { ok: true, subreddit: null };
  if (raw.length > 300 || /[\r\n\s]/.test(raw)) return { ok: false, error: 'Enter a subreddit such as r/YourCommunity.' };

  let candidate: string | undefined;
  if (/reddit\.com/i.test(raw)) {
    try {
      const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
      if (!REDDIT_HOST.test(url.hostname)) return { ok: false, error: 'Enter a reddit.com subreddit link or just the subreddit name.' };
      candidate = url.pathname.match(/^\/r\/([^/]+)/i)?.[1];
    } catch {
      return { ok: false, error: 'Enter a subreddit such as r/YourCommunity.' };
    }
    if (!candidate) return { ok: false, error: 'That link is not a subreddit (it should look like reddit.com/r/YourCommunity).' };
  } else {
    candidate = raw.replace(/^\/+/, '').replace(/^r\//i, '').replace(/\/+$/, '');
  }

  if (!NAME.test(candidate)) return { ok: false, error: 'Subreddit names are 3–21 letters, numbers, or underscores.' };
  return { ok: true, subreddit: candidate };
}

export function subredditUrl(subreddit: string): string {
  return `https://www.reddit.com/r/${subreddit}`;
}
