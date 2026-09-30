import 'server-only';
import { Types } from 'mongoose';
import { MailAccount, MailMessage, type MailAccountDoc } from '@/lib/models/Mail';
import { getCompanyProfile, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { openSecret, sealSecret } from '@/lib/security/secretBox';
import { GmailApi, GmailAuthError, refreshAccessToken } from './gmailClient';
import { GMAIL_SCOPES } from './gmailOAuth';
import type { ParsedMessage } from './gmailParse';
import { syncMailbox, type MailStore } from './syncEngine';
import { loadOrgTriageData, triagingStore } from './triageContext';
import { aiTriageUncertain } from './ai';

/**
 * Connected Gmail mailboxes: connecting (OAuth), listing, tagging with a company, removing, and keeping each
 * one synced. Mail is for managers and administrators only.
 */

import { canUseMail, MAIL_FORBIDDEN } from './access';
export { canUseMail, MAIL_FORBIDDEN };

const purposeFor = (email: string) => `mail-gmail:${email.toLowerCase()}`;
const SYNC_LOCK_MS = 4 * 60_000;

export interface MailAccountView {
  id: string;
  emailAddress: string;
  label: string;
  color: string;
  companyId: string | null;
  companyName: string | null;
  unread: number;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
  needsReauth: boolean;
}

type AccountRow = MailAccountDoc & { _id: Types.ObjectId };

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google sign-in is not configured.');
  return { clientId, clientSecret };
}

// Access tokens live ~1 hour; keep them for a few minutes less so a sync never starts with a dying one.
const tokenCache = new Map<string, { token: string; expires: number }>();

export async function apiForAccount(account: Pick<AccountRow, '_id' | 'emailAddress' | 'refreshTokenSealed'>, fetchImpl: typeof fetch = fetch): Promise<GmailApi> {
  const key = String(account._id);
  const cached = tokenCache.get(key);
  if (cached && cached.expires > Date.now()) return new GmailApi(cached.token, fetchImpl);
  const refresh = openSecret(purposeFor(account.emailAddress), account.refreshTokenSealed);
  const { accessToken, expiresInSeconds } = await refreshAccessToken(refresh, credentials(), fetchImpl);
  tokenCache.set(key, { token: accessToken, expires: Date.now() + Math.max(60, expiresInSeconds - 300) * 1000 });
  return new GmailApi(accessToken, fetchImpl);
}

export function mailStoreFor(organizationId: Types.ObjectId, accountId: Types.ObjectId): MailStore {
  return {
    async upsert(m: ParsedMessage) {
      const { gmailId, ...fields } = m;
      await MailMessage.updateOne({ organizationId, accountId, gmailId }, { $set: { ...fields, organizationId, accountId, gmailId } }, { upsert: true });
    },
    async remove(ids: string[]) {
      if (ids.length) await MailMessage.deleteMany({ organizationId, accountId, gmailId: { $in: ids } });
    },
  };
}

export type SyncOutcome = { ok: true; fetched: number; removed: number } | { ok: false; error: string; needsReauth?: boolean };

/** Sync one mailbox. Safe to call from a cron, a button, or the connect flow: a lock keeps runs from overlapping. */
export async function syncAccount(accountId: Types.ObjectId | string, fetchImpl: typeof fetch = fetch): Promise<SyncOutcome> {
  const id = new Types.ObjectId(String(accountId));
  const now = new Date();
  const account = await MailAccount.findOneAndUpdate(
    { _id: id, $or: [{ syncingUntil: { $exists: false } }, { syncingUntil: null }, { syncingUntil: { $lt: now } }] },
    { $set: { syncingUntil: new Date(now.getTime() + SYNC_LOCK_MS) } },
    { new: true }
  ).lean<AccountRow>();
  if (!account) return { ok: false, error: 'A sync is already running for this mailbox.' };
  try {
    const api = await apiForAccount(account, fetchImpl);
    // Company domains count as "ours": mail from them is never triaged away.
    const data = await loadOrgTriageData(account.organizationId);
    const result = await syncMailbox(api, triagingStore(account.organizationId, account._id, data), account.historyId);
    await MailAccount.updateOne(
      { _id: id },
      { $set: { lastSyncAt: new Date(), lastSyncOk: true, needsReauth: false, ...(result.historyId ? { historyId: result.historyId } : {}) }, $unset: { lastSyncError: 1, syncingUntil: 1 } }
    );
    // New mail the rules could not place gets a free AI second opinion. Never blocks or fails the sync.
    if (result.fetched > 0 && account.createdByUserId) await aiTriageUncertain(account.organizationId, { userId: String(account.createdByUserId), limit: 6 }).catch(() => undefined);
    return { ok: true, fetched: result.fetched, removed: result.removed };
  } catch (error) {
    const reauth = error instanceof GmailAuthError;
    const message = error instanceof Error ? error.message.slice(0, 280) : 'Sync failed.';
    if (reauth) tokenCache.delete(String(id));
    await MailAccount.updateOne({ _id: id }, { $set: { lastSyncAt: new Date(), lastSyncOk: false, lastSyncError: message, ...(reauth ? { needsReauth: true } : {}) }, $unset: { syncingUntil: 1 } });
    return { ok: false, error: message, needsReauth: reauth };
  }
}

/** Mailboxes due for a sync, oldest first (for the cron). Mailboxes needing re-connection are skipped. */
export async function syncDueAccounts(options: { olderThanMs?: number; limit?: number } = {}): Promise<{ synced: number; failed: number }> {
  const cutoff = new Date(Date.now() - (options.olderThanMs ?? 2 * 60_000));
  const due = await MailAccount.find({ needsReauth: { $ne: true }, $or: [{ lastSyncAt: { $exists: false } }, { lastSyncAt: null }, { lastSyncAt: { $lt: cutoff } }] })
    .sort({ lastSyncAt: 1 })
    .limit(options.limit ?? 10)
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();
  let synced = 0;
  let failed = 0;
  for (const row of due) {
    const outcome = await syncAccount(row._id);
    if (outcome.ok) synced += 1;
    else failed += 1;
  }
  return { synced, failed };
}

export async function listAccounts(viewer: CompanyViewer): Promise<MailAccountView[] | null> {
  if (!canUseMail(viewer)) return null;
  const rows = await MailAccount.find({ organizationId: viewer.organizationId }).sort({ emailAddress: 1 }).lean<AccountRow[]>();
  const unread = await MailMessage.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { organizationId: viewer.organizationId, unread: true, inInbox: true, trashed: false } },
    { $group: { _id: '$accountId', n: { $sum: 1 } } },
  ]);
  const unreadBy = new Map(unread.map((u) => [String(u._id), u.n]));
  const companies = new Map((await listCompanyProfiles(viewer)).map((c) => [c.id, c.name]));
  return rows.map((a) => ({
    id: String(a._id),
    emailAddress: a.emailAddress,
    label: a.label ?? '',
    color: a.color ?? '',
    companyId: a.companyId ? String(a.companyId) : null,
    companyName: a.companyId ? companies.get(String(a.companyId)) ?? null : null,
    unread: unreadBy.get(String(a._id)) ?? 0,
    lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    lastSyncOk: a.lastSyncOk ?? null,
    lastSyncError: a.lastSyncError ?? null,
    needsReauth: Boolean(a.needsReauth),
  }));
}

export type AccountResult = { ok: true } | { ok: false; status: 400 | 403 | 404; error: string };

export async function updateAccount(viewer: CompanyViewer, id: string, patch: { label?: string; color?: string; companyId?: string | null }): Promise<AccountResult> {
  if (!canUseMail(viewer)) return { ok: false, status: 403, error: MAIL_FORBIDDEN };
  if (!Types.ObjectId.isValid(id)) return { ok: false, status: 404, error: 'Mailbox not found.' };
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (patch.label !== undefined) set.label = patch.label.trim().slice(0, 80);
  if (patch.color !== undefined) set.color = /^#[0-9a-fA-F]{3,8}$/.test(patch.color) ? patch.color : '';
  if (patch.companyId !== undefined) {
    if (patch.companyId === null || patch.companyId === '') unset.companyId = 1;
    else if (await getCompanyProfile(viewer, patch.companyId)) set.companyId = new Types.ObjectId(patch.companyId);
    else return { ok: false, status: 400, error: 'Company not found.' };
  }
  const updated = await MailAccount.updateOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  return updated.matchedCount ? { ok: true } : { ok: false, status: 404, error: 'Mailbox not found.' };
}

/** Disconnect a mailbox: its synced copy is deleted too. (Nothing changes in Gmail itself.) */
export async function removeAccount(viewer: CompanyViewer, id: string): Promise<AccountResult> {
  if (!canUseMail(viewer)) return { ok: false, status: 403, error: MAIL_FORBIDDEN };
  if (!Types.ObjectId.isValid(id)) return { ok: false, status: 404, error: 'Mailbox not found.' };
  const _id = new Types.ObjectId(id);
  const gone = await MailAccount.findOneAndDelete({ _id, organizationId: viewer.organizationId }).lean<AccountRow>();
  if (!gone) return { ok: false, status: 404, error: 'Mailbox not found.' };
  tokenCache.delete(id);
  await MailMessage.deleteMany({ organizationId: viewer.organizationId, accountId: _id });
  return { ok: true };
}

export type ConnectResult = { ok: true; emailAddress: string; fetched: number } | { ok: false; error: string };

/** Finishes Google sign-in: stores the mailbox (one per address), files it under a company if one was chosen, and runs a first sync. */
export async function completeGmailConnection(viewer: CompanyViewer, input: { code: string; redirectUri: string; companyId?: string | null }, fetchImpl: typeof fetch = fetch): Promise<ConnectResult> {
  if (!canUseMail(viewer)) return { ok: false, error: MAIL_FORBIDDEN };
  let creds: { clientId: string; clientSecret: string };
  try {
    creds = credentials();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Google sign-in is not configured.' };
  }
  const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: input.code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: input.redirectUri, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) return { ok: false, error: 'Google did not accept the sign-in. Please try again.' };
  const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!tokens.access_token || !tokens.refresh_token) return { ok: false, error: 'Google did not grant offline access. Try again and approve every permission.' };
  const granted = new Set((tokens.scope ?? '').split(' '));
  if (!GMAIL_SCOPES.every((scope) => granted.has(scope))) return { ok: false, error: 'Not every Gmail permission was approved. Connect again and tick them all.' };

  let emailAddress: string;
  try {
    emailAddress = (await new GmailApi(tokens.access_token, fetchImpl).profile()).emailAddress.toLowerCase();
  } catch (error) {
    return { ok: false, error: `Signed in, but Gmail did not answer (${error instanceof Error ? error.message.slice(0, 120) : 'unknown error'}). Check that the Gmail API is enabled for the Google project.` };
  }

  let companyId: Types.ObjectId | undefined;
  if (input.companyId && (await getCompanyProfile(viewer, input.companyId))) companyId = new Types.ObjectId(input.companyId);
  const account = await MailAccount.findOneAndUpdate(
    { organizationId: viewer.organizationId, emailAddress },
    {
      $set: { provider: 'gmail', refreshTokenSealed: sealSecret(purposeFor(emailAddress), tokens.refresh_token), scopes: [...granted], needsReauth: false, createdByUserId: new Types.ObjectId(viewer.userId), ...(companyId ? { companyId } : {}) },
      $setOnInsert: { label: emailAddress.split('@')[0] },
      $unset: { lastSyncError: 1 },
    },
    { upsert: true, new: true }
  ).lean<AccountRow>();
  tokenCache.delete(String(account!._id));
  const first = await syncAccount(account!._id, fetchImpl);
  return { ok: true, emailAddress, fetched: first.ok ? first.fetched : 0 };
}
