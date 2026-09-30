import 'server-only';
import { Types } from 'mongoose';
import { CompanyTestAccount } from '@/lib/models/CompanyTestAccount';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { openSecret, sealSecret, secretHint } from '@/lib/security/secretBox';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { browserObserve } from '@/lib/ai/tools/browserClient';
import { isBrowserWorkerConfigured } from '@/lib/ai/tools/browseRouter';

/**
 * A company's test account: a low-privilege login on its own site that Nucleas uses only to open pages
 * read-only while planning a change (what the page shows right now). Managers set it up; the password is
 * sealed and never leaves the server.
 */

export interface TestAccountView {
  configured: boolean;
  canManage: boolean;
  browserWorker: boolean;
  baseUrl: string | null;
  username: string | null;
  passwordHint: string | null;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckNote: string | null;
}

const purpose = (companyId: string) => `company-test-account:${companyId}`;

type Row = { baseUrl: string; username: string; passwordSealed: string; passwordHint?: string; lastCheckedAt?: Date; lastCheckOk?: boolean; lastCheckNote?: string };

/** "https://playbound.club/admin" or "playbound.club" → "https://playbound.club". Throws on anything that is not a public https site. */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim();
  const url = assertSafePublicHttpsUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.username || url.password) throw new Error('Do not put credentials in the address.');
  return url.origin;
}

export async function getTestAccount(viewer: CompanyViewer, companyId: string): Promise<TestAccountView | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  const row = await CompanyTestAccount.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId) }).lean<Row>();
  return {
    configured: Boolean(row),
    canManage: isCompanyManager(viewer),
    browserWorker: isBrowserWorkerConfigured(),
    baseUrl: row?.baseUrl ?? null,
    username: row?.username ?? null,
    passwordHint: row?.passwordHint ?? null,
    lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
    lastCheckOk: row?.lastCheckOk ?? null,
    lastCheckNote: row?.lastCheckNote ?? null,
  };
}

export type TestAccountResult = { ok: true } | { ok: false; status: 400 | 403 | 404; error: string };

export async function setTestAccount(viewer: CompanyViewer, companyId: string, input: { baseUrl: string; username: string; password?: string }): Promise<TestAccountResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can set up a test account.' };
  if (!(await getCompanyProfile(viewer, companyId))) return { ok: false, status: 404, error: 'Company not found.' };
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl);
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : 'Enter the site’s https address.' };
  }
  const username = input.username.trim().slice(0, 200);
  if (!username) return { ok: false, status: 400, error: 'Enter the test account’s username or email.' };
  const filter = { organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId) };
  const existing = await CompanyTestAccount.findOne(filter).select('_id').lean();
  const password = input.password?.trim();
  if (!password && !existing) return { ok: false, status: 400, error: 'Enter the test account’s password.' };
  await CompanyTestAccount.findOneAndUpdate(
    filter,
    {
      $set: {
        baseUrl,
        username,
        ...(password ? { passwordSealed: sealSecret(purpose(companyId), password), passwordHint: secretHint(password) } : {}),
        updatedByUserId: new Types.ObjectId(viewer.userId),
      },
      $unset: { lastCheckedAt: 1, lastCheckOk: 1, lastCheckNote: 1 },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  const { recordActivity } = await import('@/lib/companies/activityLog');
  await recordActivity({ organizationId: viewer.organizationId, companyId, kind: 'code', title: `Test account set for ${new URL(baseUrl).host}`, actorUserId: viewer.userId });
  return { ok: true };
}

export async function clearTestAccount(viewer: CompanyViewer, companyId: string): Promise<TestAccountResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can remove the test account.' };
  if (!(await getCompanyProfile(viewer, companyId))) return { ok: false, status: 404, error: 'Company not found.' };
  await CompanyTestAccount.deleteOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId) });
  return { ok: true };
}

/** The credentials, decrypted, for the server-side observer only. Never pass the result to a model or a client. */
async function credentials(viewer: CompanyViewer, companyId: string) {
  const row = await CompanyTestAccount.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId) }).lean<Row>();
  if (!row) return null;
  try {
    return { baseUrl: row.baseUrl, username: row.username, password: openSecret(purpose(companyId), row.passwordSealed) };
  } catch {
    return null; // The master secret was rotated: the account must be entered again.
  }
}

/** Log in and open the site's home page, recording whether the account works. */
export async function checkTestAccount(viewer: CompanyViewer, companyId: string): Promise<{ ok: boolean; note: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, note: 'Only managers and administrators can test the account.' };
  const account = await credentials(viewer, companyId);
  if (!account) return { ok: false, note: 'No test account is saved for this company (or it must be re-entered).' };
  let ok = false;
  let note: string;
  try {
    const seen = await browserObserve({ ...account, url: `${account.baseUrl}/admin` });
    ok = seen.loggedIn;
    note = ok ? 'Signed in and opened the admin area.' : seen.note || 'The login was not accepted.';
  } catch (error) {
    note = error instanceof Error ? error.message.slice(0, 250) : 'The check failed.';
  }
  await CompanyTestAccount.updateOne(
    { organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId) },
    { $set: { lastCheckedAt: new Date(), lastCheckOk: ok, lastCheckNote: note } }
  );
  return { ok, note };
}

/** A page address in the request text that belongs to the test account's site. */
export function pageInRequest(text: string, baseUrl: string): string | null {
  const host = new URL(baseUrl).host.toLowerCase().replace(/^www\./, '');
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?${escaped}(\\/[^\\s"'<>)\\]]*)?`, 'i').exec(text);
  if (!match) return null;
  const path = (match[1] ?? '/').replace(/[.,;:!?]+$/, '') || '/';
  return `${new URL(baseUrl).origin}${path}`;
}

/** Open the page the request names, if the company has a test account for that site. Best effort: null on any failure. */
export async function observePageForRequest(
  viewer: CompanyViewer,
  companyId: string,
  requestText: string,
  options: { signal?: AbortSignal; onProgress?: (text: string) => void } = {}
): Promise<{ url: string; title: string | null; text: string } | { failure: string } | null> {
  if (!isBrowserWorkerConfigured()) return null;
  const account = await credentials(viewer, companyId);
  if (!account) return null;
  const url = pageInRequest(requestText, account.baseUrl);
  if (!url) return null;
  options.onProgress?.(`Opening ${new URL(url).host}${new URL(url).pathname} with the test account`);
  try {
    const seen = await browserObserve({ ...account, url }, { signal: options.signal, timeoutMs: 30000 });
    if (!seen.loggedIn) return { failure: seen.note || 'The test account was not accepted.' };
    return { url: seen.url, title: seen.title, text: seen.text };
  } catch (error) {
    return { failure: error instanceof Error ? error.message.slice(0, 200) : 'The page could not be opened.' };
  }
}
