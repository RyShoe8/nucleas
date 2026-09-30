import type { GmailMessage } from './gmailParse';

type FetchLike = typeof fetch;

/** The Google grant was revoked or has expired: the mailbox must be connected again. */
export class GmailAuthError extends Error {}
/** Gmail no longer has history that far back: start over with a fresh sync. */
export class GmailHistoryExpired extends Error {}

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TIMEOUT_MS = 20_000;

/** A refresh token → a short-lived access token. `invalid_grant` means the person revoked access or it expired. */
export async function refreshAccessToken(refreshToken: string, credentials: { clientId: string; clientSecret: string }, fetchImpl: FetchLike = fetch): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 400 || res.status === 401) throw new GmailAuthError(body.error === 'invalid_grant' ? 'Google access was revoked or expired.' : `Google refused the sign-in (${body.error ?? res.status}).`);
    throw new Error(`Google token endpoint returned ${res.status}`);
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new GmailAuthError('Google returned no access token.');
  return { accessToken: body.access_token, expiresInSeconds: body.expires_in ?? 3000 };
}

export interface HistoryRecord {
  messagesAdded?: { message: { id: string; labelIds?: string[] } }[];
  messagesDeleted?: { message: { id: string } }[];
  labelsAdded?: { message: { id: string } }[];
  labelsRemoved?: { message: { id: string } }[];
}

/** The Gmail calls Nucleas uses. Every method throws on failure; 401/403-auth becomes GmailAuthError. */
export class GmailApi {
  constructor(private accessToken: string, private fetchImpl: FetchLike = fetch) {}

  private async call<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined> } = {}): Promise<T> {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else if (v !== undefined) url.searchParams.set(k, v);
    }
    const res = await this.fetchImpl(url.toString(), {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) throw new GmailAuthError('Google access was revoked or expired.');
    if (res.status === 404 && path.startsWith('/history')) throw new GmailHistoryExpired('Gmail history is too old.');
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
      if (res.status === 403 && /insufficient|scope|permission/i.test(detail.error?.message ?? '')) throw new GmailAuthError('Gmail access was not granted. Connect the mailbox again and approve every permission.');
      throw new Error(`Gmail ${path.split('?')[0]} returned ${res.status}${detail.error?.message ? `: ${detail.error.message.slice(0, 120)}` : ''}`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  profile() {
    return this.call<{ emailAddress: string; historyId: string; messagesTotal?: number }>('/profile');
  }

  async listMessageIds(options: { q?: string; labelIds?: string[]; pageToken?: string; maxResults?: number }) {
    const data = await this.call<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>('/messages', {
      query: { q: options.q, labelIds: options.labelIds, pageToken: options.pageToken, maxResults: String(options.maxResults ?? 100) },
    });
    return { ids: (data.messages ?? []).map((m) => m.id), nextPageToken: data.nextPageToken };
  }

  getMessage(id: string) {
    return this.call<GmailMessage>(`/messages/${encodeURIComponent(id)}`, { query: { format: 'full' } });
  }

  async listHistory(startHistoryId: string, pageToken?: string) {
    const data = await this.call<{ history?: HistoryRecord[]; nextPageToken?: string; historyId?: string }>('/history', {
      query: { startHistoryId, pageToken, maxResults: '200', historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'] },
    });
    return { history: data.history ?? [], nextPageToken: data.nextPageToken, historyId: data.historyId };
  }

  modify(id: string, change: { add?: string[]; remove?: string[] }) {
    return this.call<GmailMessage>(`/messages/${encodeURIComponent(id)}/modify`, { method: 'POST', body: { addLabelIds: change.add ?? [], removeLabelIds: change.remove ?? [] } });
  }

  trash(id: string) {
    return this.call<GmailMessage>(`/messages/${encodeURIComponent(id)}/trash`, { method: 'POST' });
  }

  send(raw: string, threadId?: string) {
    return this.call<{ id: string; threadId: string }>('/messages/send', { method: 'POST', body: { raw, ...(threadId ? { threadId } : {}) } });
  }

  async attachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const data = await this.call<{ data?: string }>(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    return Buffer.from((data.data ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }
}
