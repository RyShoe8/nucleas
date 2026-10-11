export interface RedditPost {
  title: string;
  body: string;
  /** Title, blank line, body: what a person pastes when the form is not split. */
  combined: string;
}

const TITLE_MAX = 300;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isRedditRecord(values: Record<string, unknown>): boolean {
  return /reddit/i.test(text(values.platform));
}

/** A Reddit post's title and body from a social-media record; the title falls back to the first line of the copy. */
export function redditPostFromRecord(values: Record<string, unknown>): RedditPost | null {
  if (!isRedditRecord(values)) return null;
  const copy = text(values.post_copy);
  let title = text(values.post_title).replace(/\s+/g, ' ');
  let body = copy;
  if (!title) {
    if (!copy) return null;
    const lines = copy.split(/\r?\n/);
    const first = lines.findIndex((line) => line.trim());
    title = lines[first].replace(/^#+\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').replace(/\s+/g, ' ').trim();
    body = lines.slice(first + 1).join('\n').trim();
  }
  if (!title) return null;
  if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;
  return { title, body, combined: body ? `${title}\n\n${body}` : title };
}

export function subredditSubmitUrl(subreddit: string): string {
  return `https://www.reddit.com/r/${subreddit}/submit`;
}
