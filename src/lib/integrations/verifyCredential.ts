/**
 * Verifies an API credential against its provider before it is stored. Deterministic code only;
 * never logs or returns the credential. `fetchImpl` is injectable for tests.
 */

export type VerifyOutcome =
  | { ok: true; accountLabel?: string; planLabel?: string; planLimited?: boolean }
  | { ok: false; reason: 'invalid_credential' | 'wrong_key_type' | 'plan_limited' | 'unreachable' | 'unsupported'; message: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body: (body ?? {}) as Record<string, unknown> };
}

function authFailure(status: number): VerifyOutcome | null {
  if (status === 401 || status === 403) return { ok: false, reason: 'invalid_credential', message: 'The provider rejected this credential.' };
  if (status >= 500) return { ok: false, reason: 'unreachable', message: `Provider returned ${status}. Try again shortly.` };
  return null;
}

export async function verifyCredential(provider: string, credential: string, fetchImpl: FetchLike = fetch): Promise<VerifyOutcome> {
  const key = credential.trim();
  if (!key) return { ok: false, reason: 'invalid_credential', message: 'Credential is empty.' };
  try {
    switch (provider) {
      case 'brevo': {
        const { status, body } = await getJson(fetchImpl, 'https://api.brevo.com/v3/account', { 'api-key': key });
        const fail = authFailure(status);
        if (fail) return fail;
        const plans = Array.isArray(body.plan) ? (body.plan as { type?: string }[]).map((p) => p.type).filter(Boolean) : [];
        return { ok: true, accountLabel: String(body.companyName ?? body.email ?? 'Brevo account'), planLabel: plans.join(', ') || undefined };
      }
      case 'stripe': {
        // Company Stripe access must be a restricted read-only key, never a full secret key.
        if (!key.startsWith('rk_')) {
          return { ok: false, reason: 'wrong_key_type', message: 'Use a restricted key (rk_…) with read-only permissions, not a secret key.' };
        }
        const { status, body } = await getJson(fetchImpl, 'https://api.stripe.com/v1/charges?limit=1', { authorization: `Bearer ${key}` });
        if (status === 403) return { ok: false, reason: 'invalid_credential', message: 'Key is valid but lacks read access to charges.' };
        const fail = authFailure(status);
        if (fail) return fail;
        if (status !== 200) return { ok: false, reason: 'invalid_credential', message: `Stripe returned ${status}.` };
        const livemode = Array.isArray(body.data) && (body.data[0] as { livemode?: boolean } | undefined)?.livemode;
        return { ok: true, accountLabel: key.startsWith('rk_test_') ? 'Stripe (test mode)' : 'Stripe', planLabel: livemode === false ? 'test' : undefined };
      }
      case 'ahrefs': {
        const { status, body } = await getJson(fetchImpl, 'https://api.ahrefs.com/v3/subscription-info/limits-and-usage', { authorization: `Bearer ${key}` });
        // A valid key on a plan without API access answers "Insufficient plan" (status not relied on).
        // The key is kept and marked plan-limited so capabilities light up after an upgrade + re-verify.
        // An invalid key answers 401 ["Error","Unauthorized"].
        if (status >= 400 && /insufficient plan/i.test(JSON.stringify(body))) {
          return { ok: true, accountLabel: 'Ahrefs', planLabel: 'No API access on current plan', planLimited: true };
        }
        if (status === 401 || status === 403) {
          return { ok: false, reason: 'invalid_credential', message: 'Ahrefs rejected this API key. Use a key from Account settings → API keys (not an MCP key).' };
        }
        const fail = authFailure(status);
        if (fail) return fail;
        const limits = (body.limits_and_usage ?? {}) as Record<string, unknown>;
        const plan = typeof limits.subscription === 'string' ? limits.subscription : undefined;
        const used = typeof limits.units_usage_workspace === 'number' ? limits.units_usage_workspace : undefined;
        const cap = typeof limits.units_limit_workspace === 'number' ? limits.units_limit_workspace : undefined;
        const units = used !== undefined && cap !== undefined ? ` · ${used.toLocaleString('en-US')}/${cap.toLocaleString('en-US')} units` : '';
        return { ok: true, accountLabel: 'Ahrefs', planLabel: plan ? `${plan}${units}` : undefined, planLimited: cap === 0 };
      }
      case 'posthog': {
        const { status, body } = await getJson(fetchImpl, 'https://us.posthog.com/api/users/@me/', { authorization: `Bearer ${key}` });
        const fail = authFailure(status);
        if (fail) return fail;
        return { ok: true, accountLabel: String((body.organization as { name?: string } | undefined)?.name ?? 'PostHog') };
      }
      case 'mercury': {
        // Lists accounts only to prove access; balances are never returned from verification.
        const { status, body } = await getJson(fetchImpl, 'https://api.mercury.com/api/v1/accounts', { authorization: `Bearer ${key}` });
        const fail = authFailure(status);
        if (fail) return fail;
        if (status !== 200) return { ok: false, reason: 'invalid_credential', message: `Mercury returned ${status}.` };
        const count = Array.isArray(body.accounts) ? body.accounts.length : 0;
        return { ok: true, accountLabel: `Mercury · ${count} account${count === 1 ? '' : 's'}` };
      }
      case 'vercel': {
        const { status, body } = await getJson(fetchImpl, 'https://api.vercel.com/v2/user', { authorization: `Bearer ${key}` });
        const fail = authFailure(status);
        if (fail) return fail;
        return { ok: true, accountLabel: String((body.user as { username?: string } | undefined)?.username ?? 'Vercel') };
      }
      default:
        return { ok: false, reason: 'unsupported', message: `${provider} is not connected with an API key.` };
    }
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, reason: 'unreachable', message: timeout ? 'Provider did not respond in time.' : 'Could not reach the provider.' };
  }
}
