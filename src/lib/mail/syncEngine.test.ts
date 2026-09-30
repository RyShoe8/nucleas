import { describe, expect, it } from 'vitest';
import { GmailApi, GmailAuthError, refreshAccessToken } from './gmailClient';
import { syncMailbox, type MailStore } from './syncEngine';
import type { ParsedMessage } from './gmailParse';

const msg = (id: string, labels: string[] = ['INBOX']) => ({ id, threadId: `t${id}`, labelIds: labels, internalDate: '1700000000000', payload: { headers: [{ name: 'Subject', value: `s${id}` }, { name: 'From', value: 'a@b.com' }], mimeType: 'text/plain', body: { data: Buffer.from('hi').toString('base64url') } } });

function fakeGmail(handlers: Record<string, (url: URL) => unknown | Response>) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const key = url.pathname.replace('/gmail/v1/users/me', '');
    calls.push(`${key}${url.search}`);
    const handler = Object.entries(handlers).find(([k]) => key === k || (k.endsWith('*') && key.startsWith(k.slice(0, -1))));
    if (!handler) return new Response('{}', { status: 404 });
    const out = handler[1](url);
    return out instanceof Response ? out : Response.json(out);
  };
  return { api: new GmailApi('token', fetchImpl), calls };
}

function memoryStore() {
  const rows = new Map<string, ParsedMessage>();
  const store: MailStore = { upsert: async (m) => { rows.set(m.gmailId, m); }, remove: async (ids) => { ids.forEach((i) => rows.delete(i)); } };
  return { rows, store };
}

describe('syncMailbox', () => {
  it('backfills the last 30 days on the first run and keeps the cursor taken before it started', async () => {
    const { api, calls } = fakeGmail({
      '/profile': () => ({ emailAddress: 'me@x.com', historyId: '100' }),
      '/messages': () => ({ messages: [{ id: '1', threadId: 't1' }, { id: '2', threadId: 't2' }, { id: '3', threadId: 't3' }] }),
      '/messages/*': (url) => msg(url.pathname.split('/').pop()!, url.pathname.endsWith('/3') ? ['SPAM'] : ['INBOX']),
    });
    const { rows, store } = memoryStore();
    const result = await syncMailbox(api, store, null);
    expect(result).toMatchObject({ fetched: 2, removed: 1, historyId: '100', reset: false, partial: false });
    expect([...rows.keys()].sort()).toEqual(['1', '2']);
    expect(calls.find((c) => c.startsWith('/messages?'))).toContain('newer_than%3A30d');
  });

  it('applies only what changed since the cursor: new mail, label changes, deletions', async () => {
    const { api } = fakeGmail({
      '/history': () => ({ historyId: '120', history: [
        { messagesAdded: [{ message: { id: '5' } }] },
        { labelsRemoved: [{ message: { id: '1' } }] },
        { messagesDeleted: [{ message: { id: '2' } }] },
      ] }),
      '/messages/*': (url) => msg(url.pathname.split('/').pop()!, ['STARRED']),
    });
    const { rows, store } = memoryStore();
    rows.set('1', {} as ParsedMessage); rows.set('2', {} as ParsedMessage);
    const result = await syncMailbox(api, store, '100');
    expect(result).toMatchObject({ fetched: 2, removed: 1, historyId: '120', partial: false });
    expect([...rows.keys()].sort()).toEqual(['1', '5']);
    expect(rows.get('1')?.starred).toBe(true);
  });

  it('starts over when Gmail no longer has history that old', async () => {
    const { api } = fakeGmail({
      '/history': () => new Response('{}', { status: 404 }),
      '/profile': () => ({ emailAddress: 'me@x.com', historyId: '900' }),
      '/messages': () => ({ messages: [{ id: '7', threadId: 't7' }] }),
      '/messages/*': () => msg('7'),
    });
    const { store } = memoryStore();
    expect(await syncMailbox(api, store, '1')).toMatchObject({ reset: true, fetched: 1, historyId: '900' });
  });
});

describe('Google tokens', () => {
  it('reports a revoked grant as a re-connect problem, not a crash', async () => {
    const fetchImpl: typeof fetch = async () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    await expect(refreshAccessToken('r', { clientId: 'c', clientSecret: 's' }, fetchImpl)).rejects.toBeInstanceOf(GmailAuthError);
    const ok: typeof fetch = async () => Response.json({ access_token: 'a', expires_in: 3599 });
    expect(await refreshAccessToken('r', { clientId: 'c', clientSecret: 's' }, ok)).toEqual({ accessToken: 'a', expiresInSeconds: 3599 });
  });

  it('turns a 401 from Gmail into the same re-connect signal', async () => {
    const api = new GmailApi('t', async () => new Response('{}', { status: 401 }));
    await expect(api.profile()).rejects.toBeInstanceOf(GmailAuthError);
  });
});
