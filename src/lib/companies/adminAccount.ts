import 'server-only';
import { Types } from 'mongoose';
import { CompanyAdminAccount } from '@/lib/models/CompanyAdminAccount';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { openSecret, sealSecret } from '@/lib/security/secretBox';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { browserObserve, browserWorkerCall } from '@/lib/ai/tools/browserClient';
import { isBrowserWorkerConfigured } from '@/lib/ai/tools/browseRouter';
import { sanitizeSessionCookies, type SessionCookie } from '@/lib/companies/sessionCookies';

/**
 * A company's admin account session: a person logs in to the company's own site themselves and the session
 * is captured, so no password is ever stored. Nucleas uses it only to open pages read-only while planning a
 * change (what the page shows right now). Managers connect it; the session cookies are sealed and never
 * leave the server.
 */

export interface AdminAccountView {
  configured: boolean;
  canManage: boolean;
  browserWorker: boolean;
  baseUrl: string | null;
  cookieCount: number;
  capturedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckNote: string | null;
}

const purpose = (companyId: string) => `company-admin-session:${companyId}`;

type Row = {
  baseUrl: string;
  sessionSealed?: string;
  cookieCount?: number;
  capturedAt?: Date;
  expiresAt?: Date;
  lastCheckedAt?: Date;
  lastCheckOk?: boolean;
  lastCheckNote?: string;
};

/** "https://playbound.club/admin" or "playbound.club" → "https://playbound.club". Throws on anything that is not a public https site. */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim();
  const url = assertSafePublicHttpsUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.username || url.password) throw new Error('Do not put credentials in the address.');
  return url.origin;
}

const scope = (viewer: CompanyViewer, companyId: string) => ({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId) });

export async function getAdminAccount(viewer: CompanyViewer, companyId: string): Promise<AdminAccountView | null> {
  if (!(await getCompanyProfile(viewer, companyId))) return null;
  const row = await CompanyAdminAccount.findOne(scope(viewer, companyId)).lean<Row>();
  const connected = Boolean(row?.sessionSealed);
  return {
    configured: connected,
    canManage: isCompanyManager(viewer),
    browserWorker: isBrowserWorkerConfigured(),
    baseUrl: row?.baseUrl ?? null,
    cookieCount: row?.cookieCount ?? 0,
    capturedAt: row?.capturedAt?.toISOString() ?? null,
    expiresAt: row?.expiresAt?.toISOString() ?? null,
    expired: Boolean(row?.expiresAt && row.expiresAt.getTime() < Date.now()),
    lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
    lastCheckOk: row?.lastCheckOk ?? null,
    lastCheckNote: row?.lastCheckNote ?? null,
  };
}

export type AdminAccountResult = { ok: true } | { ok: false; status: 400 | 403 | 404; error: string };

async function managed(viewer: CompanyViewer, companyId: string, action: string): Promise<AdminAccountResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: `Only managers and administrators can ${action}.` };
  if (!(await getCompanyProfile(viewer, companyId))) return { ok: false, status: 404, error: 'Company not found.' };
  return { ok: true };
}

async function storeSession(filter: Record<string, unknown>, companyId: string, baseUrl: string, raw: unknown): Promise<{ ok: true; count: number; organizationId: Types.ObjectId } | { ok: false; error: string }> {
  let sanitized: ReturnType<typeof sanitizeSessionCookies>;
  try {
    sanitized = sanitizeSessionCookies(raw, baseUrl);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'That is not a browser session.' };
  }
  const updated = await CompanyAdminAccount.findOneAndUpdate(
    filter,
    {
      $set: {
        baseUrl,
        sessionSealed: sealSecret(purpose(companyId), JSON.stringify(sanitized.cookies)),
        cookieCount: sanitized.cookies.length,
        capturedAt: new Date(),
        ...(sanitized.expiresAt ? { expiresAt: sanitized.expiresAt } : {}),
      },
      $unset: { lastCheckedAt: 1, lastCheckOk: 1, lastCheckNote: 1, ...(sanitized.expiresAt ? {} : { expiresAt: 1 }) },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean<{ organizationId: Types.ObjectId }>();
  return { ok: true, count: sanitized.cookies.length, organizationId: updated!.organizationId };
}

/** Save a session pasted from a logged-in browser (a Playwright storageState or a cookie export). */
export async function saveSessionPaste(viewer: CompanyViewer, companyId: string, input: { baseUrl: string; session: unknown }): Promise<AdminAccountResult> {
  const allowed = await managed(viewer, companyId, 'connect an admin account');
  if (!allowed.ok) return allowed;
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl);
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : 'Enter the site’s https address.' };
  }
  const stored = await storeSession(scope(viewer, companyId), companyId, baseUrl, input.session);
  if (!stored.ok) return { ok: false, status: 400, error: stored.error };
  const { recordActivity } = await import('@/lib/companies/activityLog');
  await recordActivity({ organizationId: viewer.organizationId, companyId, kind: 'code', title: `Admin account session captured for ${new URL(baseUrl).host}`, actorUserId: viewer.userId });
  return { ok: true };
}

// ---------- Logging in through a browser window inside Nucleas ----------

interface LoginHandle {
  s: string; // the worker's session id
  c: string; // company
  u: string; // user
  b: string; // site origin
  x: number; // expiry, ms
}

const HANDLE_PURPOSE = 'admin-login-handle';
const HANDLE_MINUTES = 10;

/** The opaque handle the page holds: it names the worker's browser window and is only valid for this person and company. */
function openHandle(viewer: CompanyViewer, companyId: string, handle: string): LoginHandle | null {
  try {
    const h = JSON.parse(openSecret(HANDLE_PURPOSE, handle)) as LoginHandle;
    return h.c === companyId && h.u === viewer.userId && h.x > Date.now() ? h : null;
  } catch {
    return null;
  }
}

const EXPIRED = { ok: false as const, status: 400 as const, error: 'The login window timed out. Start again.' };

export async function loginStart(viewer: CompanyViewer, companyId: string, siteAddress: string): Promise<{ ok: true; handle: string; width: number; height: number; baseUrl: string } | { ok: false; status: 400 | 403 | 404; error: string }> {
  const allowed = await managed(viewer, companyId, 'connect an admin account');
  if (!allowed.ok) return allowed;
  if (!isBrowserWorkerConfigured()) return { ok: false, status: 400, error: 'The browser worker is not configured on the server.' };
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(siteAddress);
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : 'Enter the site’s https address.' };
  }
  try {
    const started = await browserWorkerCall<{ sessionId: string; width: number; height: number }>('/login/start', { baseUrl });
    const handle = sealSecret(HANDLE_PURPOSE, JSON.stringify({ s: started.sessionId, c: companyId, u: viewer.userId, b: baseUrl, x: Date.now() + HANDLE_MINUTES * 60_000 } satisfies LoginHandle));
    return { ok: true, handle, width: started.width, height: started.height, baseUrl };
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : 'Could not open the login window (is the browser worker up to date?).' };
  }
}

export async function loginFrame(viewer: CompanyViewer, companyId: string, handle: string): Promise<{ ok: true; image: string; url: string; title: string } | typeof EXPIRED> {
  const h = openHandle(viewer, companyId, handle);
  if (!h) return EXPIRED;
  try {
    return { ok: true, ...(await browserWorkerCall<{ image: string; url: string; title: string }>('/login/frame', { sessionId: h.s })) };
  } catch {
    return EXPIRED;
  }
}

export async function loginInput(viewer: CompanyViewer, companyId: string, handle: string, input: unknown): Promise<{ ok: true } | typeof EXPIRED> {
  const h = openHandle(viewer, companyId, handle);
  if (!h) return EXPIRED;
  try {
    await browserWorkerCall('/login/input', { sessionId: h.s, input });
    return { ok: true };
  } catch {
    return EXPIRED;
  }
}

/** "I'm logged in": take the site's cookies from the window, seal them, close the window. */
export async function loginFinish(viewer: CompanyViewer, companyId: string, handle: string): Promise<AdminAccountResult> {
  const h = openHandle(viewer, companyId, handle);
  if (!h) return EXPIRED;
  let done: { cookies: unknown[] };
  try {
    done = await browserWorkerCall<{ cookies: unknown[] }>('/login/finish', { sessionId: h.s });
  } catch {
    return EXPIRED;
  }
  const stored = await storeSession(scope(viewer, companyId), companyId, h.b, { cookies: done.cookies });
  if (!stored.ok) return { ok: false, status: 400, error: /None of those cookies/.test(stored.error) ? 'The site did not set a session yet. Log in first, then press Save.' : stored.error };
  const { recordActivity } = await import('@/lib/companies/activityLog');
  await recordActivity({ organizationId: viewer.organizationId, companyId, kind: 'code', title: `Admin account session captured for ${new URL(h.b).host}`, actorUserId: viewer.userId });
  return { ok: true };
}

export async function loginCancel(viewer: CompanyViewer, companyId: string, handle: string): Promise<void> {
  const h = openHandle(viewer, companyId, handle);
  if (h) await browserWorkerCall('/login/cancel', { sessionId: h.s }).catch(() => undefined);
}

export async function clearAdminAccount(viewer: CompanyViewer, companyId: string): Promise<AdminAccountResult> {
  const allowed = await managed(viewer, companyId, 'remove the admin account');
  if (!allowed.ok) return allowed;
  await CompanyAdminAccount.deleteOne(scope(viewer, companyId));
  return { ok: true };
}

/** The session, decrypted, for the server-side observer only. Never pass the result to a model or a client. */
async function session(viewer: CompanyViewer, companyId: string): Promise<{ baseUrl: string; cookies: SessionCookie[] } | null> {
  const row = await CompanyAdminAccount.findOne(scope(viewer, companyId)).lean<Row>();
  if (!row?.sessionSealed) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  try {
    return { baseUrl: row.baseUrl, cookies: JSON.parse(openSecret(purpose(companyId), row.sessionSealed)) as SessionCookie[] };
  } catch {
    return null; // The master secret was rotated: the session must be captured again.
  }
}

/** Open the site's admin area with the session, recording whether it is still signed in. */
export async function checkAdminAccount(viewer: CompanyViewer, companyId: string): Promise<{ ok: boolean; note: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, note: 'Only managers and administrators can check the session.' };
  const account = await session(viewer, companyId);
  if (!account) return { ok: false, note: 'No usable session is saved for this company (it may have expired). Connect it again.' };
  let ok = false;
  let note: string;
  try {
    const seen = await browserObserve({ ...account, url: `${account.baseUrl}/admin` });
    ok = seen.loggedIn;
    note = ok ? 'Signed in and opened the admin area.' : seen.note || 'The session is no longer signed in. Connect it again.';
  } catch (error) {
    note = error instanceof Error ? error.message.slice(0, 250) : 'The check failed.';
  }
  await CompanyAdminAccount.updateOne(scope(viewer, companyId), { $set: { lastCheckedAt: new Date(), lastCheckOk: ok, lastCheckNote: note } });
  return { ok, note };
}

/** A page address in the request text that belongs to the account's site. */
export function pageInRequest(text: string, baseUrl: string): string | null {
  const host = new URL(baseUrl).host.toLowerCase().replace(/^www\./, '');
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?${escaped}(\\/[^\\s"'<>)\\]]*)?`, 'i').exec(text);
  if (!match) return null;
  const path = (match[1] ?? '/').replace(/[.,;:!?]+$/, '') || '/';
  return `${new URL(baseUrl).origin}${path}`;
}

/** Open the page the request names, if the company has a session for that site. Best effort: null on any failure. */
export async function observePageForRequest(
  viewer: CompanyViewer,
  companyId: string,
  requestText: string,
  options: { signal?: AbortSignal; onProgress?: (text: string) => void } = {}
): Promise<{ url: string; title: string | null; text: string } | { failure: string } | null> {
  if (!isBrowserWorkerConfigured()) return null;
  const account = await session(viewer, companyId);
  if (!account) return null;
  const url = pageInRequest(requestText, account.baseUrl);
  if (!url) return null;
  options.onProgress?.(`Opening ${new URL(url).host}${new URL(url).pathname} with the admin account`);
  try {
    const seen = await browserObserve({ ...account, url }, { signal: options.signal, timeoutMs: 30000 });
    if (!seen.loggedIn) return { failure: seen.note || 'The admin session is no longer signed in.' };
    return { url: seen.url, title: seen.title, text: seen.text };
  } catch (error) {
    return { failure: error instanceof Error ? error.message.slice(0, 200) : 'The page could not be opened.' };
  }
}
