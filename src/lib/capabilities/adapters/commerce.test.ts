import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { stripeRevenue } from './commerce';
import type { CapabilityRunContext } from '../types';

function ctxWith(routes: Record<string, unknown[]>): CapabilityRunContext {
  return {
    organizationId: new Types.ObjectId(),
    companyId: new Types.ObjectId(),
    access: { provider: 'stripe', connectionId: new Types.ObjectId(), credential: 'rk_live_x' },
    reportUnits: () => {},
    now: new Date(),
    fetch: vi.fn(async (url: string) => {
      const path = new URL(url).pathname.replace('/v1/', '');
      return new Response(JSON.stringify({ data: routes[path] ?? [], has_more: false }), { status: 200 });
    }),
  };
}

describe('stripeRevenue', () => {
  it('sums succeeded charges net of refunds per currency and normalizes MRR to monthly', async () => {
    const ctx = ctxWith({
      charges: [
        { id: 'c1', amount: 5000, amount_refunded: 0, currency: 'usd', paid: true, status: 'succeeded', created: 1788350400 },
        { id: 'c2', amount: 2000, amount_refunded: 500, currency: 'usd', paid: true, status: 'succeeded', created: 1788436800 },
        { id: 'c3', amount: 9999, amount_refunded: 0, currency: 'usd', paid: false, status: 'failed' },
        { id: 'c4', amount: 1000, amount_refunded: 0, currency: 'eur', paid: true, status: 'succeeded' },
      ],
      customers: [{ id: 'cus1', created: 1788350400 }, { id: 'cus2', created: 1788350400 }],
      subscriptions: [
        { id: 's1', items: { data: [{ quantity: 1, price: { unit_amount: 1200, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] } },
        { id: 's2', items: { data: [{ quantity: 2, price: { unit_amount: 12000, currency: 'usd', recurring: { interval: 'year', interval_count: 1 } } }] } },
      ],
      invoices: [
        { id: 'in1', amount_paid: 1200, currency: 'usd', created: 1788350400, status: 'paid', subscription: 's1' },
        { id: 'in2', amount_paid: 900, currency: 'usd', created: 1788436800, status: 'paid', parent: { subscription_details: { subscription: 's2' } } },
        { id: 'in3', amount_paid: 500, currency: 'usd', created: 1788436800, status: 'paid', subscription: null },
      ],
    });
    const out = await stripeRevenue(ctx, { startDate: '2026-09-01', endDate: '2026-09-27' });
    expect(out).toMatchObject({
      gross: { usd: 7000, eur: 1000 },
      refunded: { usd: 500, eur: 0 },
      net: { usd: 6500, eur: 1000 },
      payments: 3,
      newCustomers: 2,
      activeSubscriptions: 2,
      mrr: { usd: 1200 + 2000 },
      subscriberRevenue: { usd: 2100 },
      truncated: false,
    });
    expect(out.days).toEqual([
      { date: '2026-09-02', net: { usd: 5000 }, subscriberRevenue: { usd: 1200 }, payments: 1, newCustomers: 2 },
      { date: '2026-09-03', net: { usd: 1500 }, subscriberRevenue: { usd: 900 }, payments: 1, newCustomers: 0 },
    ]);
  });
});
