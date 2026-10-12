import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { ContentWatch, WatchItem, WatchMailbox } from '@/lib/models/Watch';
import { sealSecret } from '@/lib/security/secretBox';
import { GmailApi } from '@/lib/mail/gmailClient';
import { ALLOWED_CALLBACK_HOSTS } from '@/lib/integrations/google/googleOAuth';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { watchMailboxPurpose } from './runWatch';
import { canUseWatches, WATCHES_FORBIDDEN } from './access';

/**
 * Mailboxes for content watches. Each is connected on its own with read-only Gmail access (it can read mail and
 * nothing else), so a watch can monitor any address regardless of what the Mail window has connected.
 */

export const WATCH_GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const WATCH_GMAIL_CALLBACK_PATH = '/api/os/content/gmail/callback';

export function watchRedirectUri(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (!ALLOWED_CALLBACK_HOSTS.includes(url.host)) return null;
  const protocol = url.hostname.endsWith('localhost') ? 'http:' : 'https:';
  return `${protocol}//${url.host}${WATCH_GMAIL_CALLBACK_PATH}`;
}

type StatePayload = { userId: string; purpose: 'watch-google'; nonce: string };

function stateKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required');
  return new TextEncoder().encode(`watch-google:${secret}`);
}

export async function createWatchState(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: 'watch-google', nonce: randomUUID() } satisfies StatePayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(stateKey());
}

export async function verifyWatchState(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, stateKey());
    return payload.purpose === 'watch-google' && typeof payload.userId === 'string' ? { userId: payload.userId } : null;
  } catch {
    return null;
  }
}

export function googleCredentials() {
  const clientId = process.env.GOOGLE_MAIL_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_MAIL_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google sign-in is not configured.');
  return { clientId, clientSecret };
}

export function buildWatchAuthUrl(options: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', WATCH_GMAIL_SCOPE);
  url.searchParams.set('access_type', 'offline');
  // Always re-consent so Google returns a refresh token, and let the person pick which account.
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('state', options.state);
  if (options.loginHint) url.searchParams.set('login_hint', options.loginHint);
  return url.toString();
}

export type ConnectResult = { ok: true; emailAddress: string } | { ok: false; error: string };

/** Finishes Google sign-in: stores the refresh token (encrypted) for the account that signed in. */
export async function completeWatchMailbox(viewer: CompanyViewer, input: { code: string; redirectUri: string }, fetchImpl: typeof fetch = fetch): Promise<ConnectResult> {
  if (!canUseWatches(viewer)) return { ok: false, error: WATCHES_FORBIDDEN };
  const { clientId, clientSecret } = googleCredentials();
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: input.code, client_id: clientId, client_secret: clientSecret, redirect_uri: input.redirectUri, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { ok: false, error: 'Google did not accept the sign-in. Please try again.' };
  const tokens = (await res.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!tokens.access_token || !tokens.refresh_token) return { ok: false, error: 'Google did not grant lasting access. Try again and approve the request.' };
  if (!(tokens.scope ?? '').includes(WATCH_GMAIL_SCOPE)) return { ok: false, error: 'Gmail read access was not granted. Try again and approve it.' };
  const profile = await new GmailApi(tokens.access_token, fetchImpl).profile().catch(() => null);
  const emailAddress = profile?.emailAddress?.toLowerCase();
  if (!emailAddress) return { ok: false, error: 'Could not read the mailbox address from Google.' };
  await WatchMailbox.updateOne(
    { organizationId: viewer.organizationId, emailAddress },
    { $set: { refreshTokenSealed: sealSecret(watchMailboxPurpose(emailAddress), tokens.refresh_token), status: 'connected', connectedByUserId: new Types.ObjectId(viewer.userId) }, $unset: { lastError: '' } },
    { upsert: true }
  );
  return { ok: true, emailAddress };
}

export interface MailboxView {
  id: string;
  emailAddress: string;
  status: 'connected' | 'needs_reauth';
  lastError: string | null;
  watchCount: number;
}

export async function listMailboxes(viewer: CompanyViewer): Promise<MailboxView[] | null> {
  if (!canUseWatches(viewer)) return null;
  const rows = await WatchMailbox.find({ organizationId: viewer.organizationId }).sort({ emailAddress: 1 }).lean<{ _id: Types.ObjectId; emailAddress: string; status?: string; lastError?: string }[]>();
  const counts = await ContentWatch.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { organizationId: viewer.organizationId } }, { $group: { _id: '$mailboxId', n: { $sum: 1 } } }]);
  const byMailbox = new Map(counts.map((c) => [String(c._id), c.n]));
  return rows.map((r) => ({ id: String(r._id), emailAddress: r.emailAddress, status: r.status === 'needs_reauth' ? 'needs_reauth' : 'connected', lastError: r.lastError ?? null, watchCount: byMailbox.get(String(r._id)) ?? 0 }));
}

/** Removes a mailbox and the scanned emails stored from it. Watches that use it must be removed first. */
export async function removeMailbox(viewer: CompanyViewer, id: string): Promise<{ ok: true } | { ok: false; status: 400 | 403 | 404 | 409; error: string }> {
  if (!canUseWatches(viewer)) return { ok: false, status: 403, error: WATCHES_FORBIDDEN };
  if (!Types.ObjectId.isValid(id)) return { ok: false, status: 404, error: 'Mailbox not found.' };
  const mailbox = await WatchMailbox.findOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }).select('_id').lean();
  if (!mailbox) return { ok: false, status: 404, error: 'Mailbox not found.' };
  if (await ContentWatch.exists({ organizationId: viewer.organizationId, mailboxId: mailbox._id })) return { ok: false, status: 409, error: 'Remove the watches that use this mailbox first.' };
  await WatchItem.deleteMany({ organizationId: viewer.organizationId, mailboxId: mailbox._id });
  await WatchMailbox.deleteOne({ _id: mailbox._id });
  return { ok: true };
}
