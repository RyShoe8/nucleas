import type { CapabilityRunContext } from '../types';
import { providerJson } from './http';

// ---------- Brevo ----------

export interface EmailAudienceOutput {
  totalContacts: number;
  newContacts: number;
  since: string;
  /** New contacts per day (counts only; no contact data is kept). */
  days: { date: string; newContacts: number }[];
  truncated: boolean;
  lists: { id: number; name: string; subscribers: number; blocklisted: number }[];
}

export async function brevoAudience(ctx: CapabilityRunContext, input: { startDate: string }): Promise<EmailAudienceOutput> {
  const headers = { 'api-key': ctx.access.credential };
  const all = await providerJson<{ count?: number }>(ctx, 'https://api.brevo.com/v3/contacts?limit=1', { headers }, 'Brevo');
  const since = `${input.startDate}T00:00:00.000Z`;
  // Page through new contacts only to count them per day; contact data itself is discarded.
  const PAGE = 500;
  const MAX_PAGES = 20;
  const perDay = new Map<string, number>();
  let newContacts = 0;
  let truncated = false;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      truncated = true;
      break;
    }
    const batch = await providerJson<{ contacts?: { createdAt?: string }[]; count?: number }>(
      ctx,
      `https://api.brevo.com/v3/contacts?limit=${PAGE}&offset=${page * PAGE}&sort=desc&createdSince=${encodeURIComponent(since)}`,
      { headers },
      'Brevo'
    );
    const contacts = batch.contacts ?? [];
    if (page === 0) newContacts = batch.count ?? contacts.length;
    for (const c of contacts) {
      const day = c.createdAt?.slice(0, 10);
      if (day) perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    if (contacts.length < PAGE) break;
  }
  const lists = await providerJson<{ lists?: { id: number; name: string; totalSubscribers?: number; uniqueSubscribers?: number; totalBlacklisted?: number }[] }>(
    ctx,
    'https://api.brevo.com/v3/contacts/lists?limit=50&sort=desc',
    { headers },
    'Brevo'
  );
  return {
    totalContacts: all.count ?? 0,
    newContacts,
    since: input.startDate,
    days: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, n]) => ({ date, newContacts: n })),
    truncated,
    lists: (lists.lists ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      subscribers: l.uniqueSubscribers ?? l.totalSubscribers ?? 0,
      blocklisted: l.totalBlacklisted ?? 0,
    })),
  };
}

// ---------- Stripe ----------

const STRIPE_MAX_PAGES = 20;

type StripeList<T> = { data: T[]; has_more: boolean };

async function stripeAll<T extends { id: string }>(ctx: CapabilityRunContext, path: string, params: Record<string, string>): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
    const qs = new URLSearchParams({ limit: '100', ...params, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    const res = await providerJson<StripeList<T>>(ctx, `https://api.stripe.com/v1/${path}?${qs}`, { headers: { authorization: `Bearer ${ctx.access.credential}` } }, 'Stripe');
    items.push(...res.data);
    if (!res.has_more || res.data.length === 0) return { items, truncated: false };
    startingAfter = res.data[res.data.length - 1].id;
  }
  return { items, truncated: true };
}

export interface RevenueOutput {
  startDate: string;
  endDate: string;
  /** Amounts in minor units per currency (e.g. cents). */
  gross: Record<string, number>;
  refunded: Record<string, number>;
  net: Record<string, number>;
  payments: number;
  newCustomers: number;
  activeSubscriptions: number;
  /** Monthly recurring revenue per currency, minor units. */
  mrr: Record<string, number>;
  /** Per-day net revenue (minor units, per currency), payments and new customers. */
  days: { date: string; net: Record<string, number>; payments: number; newCustomers: number }[];
  truncated: boolean;
}

function add(map: Record<string, number>, currency: string, amount: number) {
  map[currency] = (map[currency] ?? 0) + amount;
}

export async function stripeRevenue(ctx: CapabilityRunContext, range: { startDate: string; endDate: string }): Promise<RevenueOutput> {
  const gte = String(Math.floor(Date.parse(`${range.startDate}T00:00:00Z`) / 1000));
  const lte = String(Math.floor(Date.parse(`${range.endDate}T23:59:59Z`) / 1000));

  const charges = await stripeAll<{ id: string; amount: number; amount_refunded: number; currency: string; paid: boolean; status: string; created: number }>(
    ctx,
    'charges',
    { 'created[gte]': gte, 'created[lte]': lte }
  );
  const customers = await stripeAll<{ id: string; created: number }>(ctx, 'customers', { 'created[gte]': gte, 'created[lte]': lte });
  const subs = await stripeAll<{
    id: string;
    items: { data: { quantity?: number; price?: { unit_amount?: number | null; currency: string; recurring?: { interval: string; interval_count: number } | null } }[] };
  }>(ctx, 'subscriptions', { status: 'active' });

  const gross: Record<string, number> = {};
  const refunded: Record<string, number> = {};
  let payments = 0;
  const dayMap = new Map<string, { net: Record<string, number>; payments: number; newCustomers: number }>();
  const dayOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);
  const bucket = (date: string) => {
    let b = dayMap.get(date);
    if (!b) dayMap.set(date, (b = { net: {}, payments: 0, newCustomers: 0 }));
    return b;
  };
  for (const c of charges.items) {
    if (!c.paid || c.status !== 'succeeded') continue;
    payments += 1;
    add(gross, c.currency, c.amount);
    add(refunded, c.currency, c.amount_refunded);
    if (typeof c.created === 'number') {
      const b = bucket(dayOf(c.created));
      b.payments += 1;
      add(b.net, c.currency, c.amount - c.amount_refunded);
    }
  }
  for (const cu of customers.items) if (typeof cu.created === 'number') bucket(dayOf(cu.created)).newCustomers += 1;
  const net: Record<string, number> = {};
  for (const cur of Object.keys(gross)) net[cur] = gross[cur] - (refunded[cur] ?? 0);

  const perMonth: Record<string, number> = { day: 30, week: 52 / 12, month: 1, year: 1 / 12 };
  const mrr: Record<string, number> = {};
  for (const s of subs.items) {
    for (const item of s.items.data) {
      const price = item.price;
      if (!price?.unit_amount || !price.recurring) continue;
      const factor = (perMonth[price.recurring.interval] ?? 0) / Math.max(1, price.recurring.interval_count);
      add(mrr, price.currency, Math.round(price.unit_amount * (item.quantity ?? 1) * factor));
    }
  }

  return {
    ...range,
    gross,
    refunded,
    net,
    payments,
    newCustomers: customers.items.length,
    activeSubscriptions: subs.items.length,
    mrr,
    days: [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    truncated: charges.truncated || customers.truncated || subs.truncated,
  };
}

// ---------- Mercury ----------

export interface CashOutput {
  accounts: { name: string; kind: string; available: number; current: number }[];
  totalAvailable: number;
  totalCurrent: number;
}

export async function mercuryCash(ctx: CapabilityRunContext): Promise<CashOutput> {
  const res = await providerJson<{ accounts?: { name?: string; kind?: string; status?: string; availableBalance?: number; currentBalance?: number }[] }>(
    ctx,
    'https://api.mercury.com/api/v1/accounts',
    { headers: { authorization: `Bearer ${ctx.access.credential}` } },
    'Mercury'
  );
  const accounts = (res.accounts ?? [])
    .filter((a) => a.status !== 'archived')
    .map((a) => ({ name: a.name ?? 'Account', kind: a.kind ?? '', available: a.availableBalance ?? 0, current: a.currentBalance ?? 0 }));
  return {
    accounts,
    totalAvailable: accounts.reduce((s, a) => s + a.available, 0),
    totalCurrent: accounts.reduce((s, a) => s + a.current, 0),
  };
}
