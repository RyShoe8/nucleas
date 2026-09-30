import { GmailHistoryExpired, type GmailApi } from './gmailClient';
import { parseGmailMessage, type ParsedMessage } from './gmailParse';

/**
 * Keeps a local copy of a mailbox in step with Gmail. First run: the last 30 days. After that: Gmail's history
 * API says exactly what changed since the saved cursor. Storage is behind an interface so this is testable.
 */

export interface MailStore {
  upsert(message: ParsedMessage): Promise<void>;
  remove(gmailIds: string[]): Promise<void>;
}

export interface SyncResult {
  fetched: number;
  removed: number;
  historyId: string | null;
  /** The cursor was too old, so a fresh 30-day sync ran instead. */
  reset: boolean;
  /** More remains than one run takes; the next run continues. */
  partial: boolean;
}

const BACKFILL_QUERY = 'newer_than:30d -in:spam';
const MAX_PER_RUN = 300;
const CONCURRENCY = 6;

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** Spam and drafts are not part of the inbox copy. */
const keep = (m: ParsedMessage) => !m.labels.includes('SPAM') && !m.labels.includes('DRAFT');

async function fetchAndStore(api: GmailApi, store: MailStore, ids: string[], result: SyncResult) {
  const gone: string[] = [];
  await inBatches(ids, CONCURRENCY, async (id) => {
    try {
      const parsed = parseGmailMessage(await api.getMessage(id));
      if (keep(parsed)) {
        await store.upsert(parsed);
        result.fetched += 1;
      } else gone.push(id);
    } catch (error) {
      // A message deleted between listing and fetching is simply gone.
      if (error instanceof Error && /returned 404/.test(error.message)) gone.push(id);
      else throw error;
    }
  });
  if (gone.length) {
    await store.remove(gone);
    result.removed += gone.length;
  }
}

async function backfill(api: GmailApi, store: MailStore, result: SyncResult) {
  // The cursor is taken first, so anything that arrives while the backfill runs is picked up next time.
  const profile = await api.profile();
  let pageToken: string | undefined;
  const ids: string[] = [];
  do {
    const page = await api.listMessageIds({ q: BACKFILL_QUERY, pageToken, maxResults: 100 });
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_PER_RUN);
  await fetchAndStore(api, store, ids.slice(0, MAX_PER_RUN), result);
  result.partial = Boolean(pageToken) || ids.length > MAX_PER_RUN;
  result.historyId = profile.historyId;
}

export async function syncMailbox(api: GmailApi, store: MailStore, historyId: string | null | undefined): Promise<SyncResult> {
  const result: SyncResult = { fetched: 0, removed: 0, historyId: historyId ?? null, reset: false, partial: false };
  if (!historyId) {
    await backfill(api, store, result);
    return result;
  }
  try {
    const changed = new Set<string>();
    const deleted = new Set<string>();
    let pageToken: string | undefined;
    let latest = historyId;
    do {
      const page = await api.listHistory(historyId, pageToken);
      for (const record of page.history) {
        for (const a of record.messagesAdded ?? []) changed.add(a.message.id);
        for (const a of record.labelsAdded ?? []) changed.add(a.message.id);
        for (const a of record.labelsRemoved ?? []) changed.add(a.message.id);
        for (const d of record.messagesDeleted ?? []) { deleted.add(d.message.id); changed.delete(d.message.id); }
      }
      if (page.historyId) latest = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken && changed.size < MAX_PER_RUN);
    for (const id of deleted) changed.delete(id);
    const ids = [...changed].slice(0, MAX_PER_RUN);
    await fetchAndStore(api, store, ids, result);
    if (deleted.size) {
      await store.remove([...deleted]);
      result.removed += deleted.size;
    }
    // Only advance the cursor when everything it covers has been applied.
    result.partial = Boolean(pageToken) || changed.size > MAX_PER_RUN;
    if (!result.partial) result.historyId = latest;
    return result;
  } catch (error) {
    if (!(error instanceof GmailHistoryExpired)) throw error;
    result.reset = true;
    await backfill(api, store, result);
    return result;
  }
}
