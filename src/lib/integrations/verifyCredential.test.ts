import { describe, expect, it, vi } from 'vitest';
import { verifyCredential } from './verifyCredential';

function fakeFetch(status: number, body: unknown) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('verifyCredential', () => {
  it('reads Brevo account identity and plan', async () => {
    const f = fakeFetch(200, { companyName: 'Frugal Gambler', plan: [{ type: 'free' }] });
    const out = await verifyCredential('brevo', 'xkeysib-abc', f);
    expect(out).toEqual({ ok: true, accountLabel: 'Frugal Gambler', planLabel: 'free' });
    expect(f.mock.calls[0][1]?.headers).toMatchObject({ 'api-key': 'xkeysib-abc' });
  });

  it('rejects Stripe secret keys before any network call', async () => {
    const f = fakeFetch(200, {});
    const out = await verifyCredential('stripe', 'sk_live_123', f);
    expect(out).toMatchObject({ ok: false, reason: 'wrong_key_type' });
    expect(f).not.toHaveBeenCalled();
  });

  it('accepts Stripe restricted keys with read access', async () => {
    const out = await verifyCredential('stripe', 'rk_live_123', fakeFetch(200, { data: [] }));
    expect(out).toMatchObject({ ok: true, accountLabel: 'Stripe' });
  });

  it('keeps Ahrefs keys on an insufficient plan as plan-limited', async () => {
    const out = await verifyCredential('ahrefs', 'ahrefs-key', fakeFetch(403, { error: 'Insufficient plan' }));
    expect(out).toMatchObject({ ok: true, planLimited: true });
  });

  it('treats insufficient plan as plan-limited whatever the status, and real rejections as invalid', async () => {
    expect(await verifyCredential('ahrefs', 'k', fakeFetch(401, { error: 'Insufficient plan' }))).toMatchObject({ ok: true, planLimited: true });
    expect(await verifyCredential('ahrefs', 'k', fakeFetch(401, ['Error', 'Unauthorized']))).toMatchObject({ ok: false, reason: 'invalid_credential' });
  });

  it('reports Ahrefs plan and unit usage', async () => {
    const out = await verifyCredential(
      'ahrefs',
      'ahrefs-key',
      fakeFetch(200, { limits_and_usage: { subscription: 'Standard', units_usage_workspace: 1200, units_limit_workspace: 150000 } })
    );
    expect(out).toEqual({ ok: true, accountLabel: 'Ahrefs', planLabel: 'Standard · 1,200/150,000 units', planLimited: false });
  });

  it('maps auth failures and outages', async () => {
    expect(await verifyCredential('brevo', 'bad', fakeFetch(401, {}))).toMatchObject({ ok: false, reason: 'invalid_credential' });
    expect(await verifyCredential('vercel', 'x', fakeFetch(503, {}))).toMatchObject({ ok: false, reason: 'unreachable' });
    const throwing = vi.fn(async () => {
      throw new TypeError('network');
    });
    expect(await verifyCredential('posthog', 'x', throwing)).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('verifies Mercury by listing accounts without exposing balances', async () => {
    const out = await verifyCredential('mercury', 'secret-token:x', fakeFetch(200, { accounts: [{ id: 'a', availableBalance: 123456 }, { id: 'b' }] }));
    expect(out).toEqual({ ok: true, accountLabel: 'Mercury · 2 accounts' });
    expect(JSON.stringify(out)).not.toContain('123456');
    expect(await verifyCredential('mercury', 'bad', fakeFetch(401, {}))).toMatchObject({ ok: false, reason: 'invalid_credential' });
  });

  it('refuses providers that are not API-key based', async () => {
    expect(await verifyCredential('ga4', 'x', fakeFetch(200, {}))).toMatchObject({ ok: false, reason: 'unsupported' });
  });
});
