import type { TrafficOutput, SearchOutput } from '@/lib/capabilities/adapters/google';
import type { AdRevenueOutput } from '@/lib/capabilities/adapters/adsense';
import type { CashOutput, EmailAudienceOutput, RevenueOutput } from '@/lib/capabilities/adapters/commerce';

/**
 * Canonical business metrics. Each maps a capability's output to daily values. Lifecycle stages
 * (Ryan, 2026-09-27): Lead = gave contact info, User = signed up free, Customer = bought,
 * Subscriber = paying on a recurring plan. Metrics say which stage they measure, not which vendor.
 */

export type MetricUnit = 'count' | 'money' | 'percent' | 'position';
export type LifecycleStage = 'visitor' | 'lead' | 'user' | 'customer' | 'subscriber';

export interface MetricPoint {
  date: string;
  value: number;
  breakdown?: Record<string, number>;
}

export interface MetricDefinition {
  key: string;
  label: string;
  unit: MetricUnit;
  /** daily = per-day flow (summable); snapshot = point-in-time level (not summable). */
  kind: 'daily' | 'snapshot';
  stage?: LifecycleStage;
  capabilityId: string;
  provider: string;
  /** Higher is better (for "what changed" direction). */
  higherIsBetter: boolean;
  sensitive?: boolean;
  extract: (output: unknown, today: string) => MetricPoint[];
}

/** Money is stored in minor units; value = USD (or the single currency present), breakdown = per currency. */
function moneyPoint(date: string, byCurrency: Record<string, number>): MetricPoint {
  const currencies = Object.keys(byCurrency);
  const value = byCurrency.usd ?? (currencies.length === 1 ? byCurrency[currencies[0]] : 0);
  return { date, value, breakdown: currencies.length ? byCurrency : undefined };
}

const traffic = (o: unknown) => o as TrafficOutput;
const search = (o: unknown) => o as SearchOutput;
const email = (o: unknown) => o as EmailAudienceOutput;
const revenue = (o: unknown) => o as RevenueOutput;
const cash = (o: unknown) => o as CashOutput;
const ads = (o: unknown) => o as AdRevenueOutput;

export const METRICS: MetricDefinition[] = [
  { key: 'sessions', label: 'Sessions', unit: 'count', kind: 'daily', stage: 'visitor', capabilityId: 'analytics.traffic.read', provider: 'ga4', higherIsBetter: true, extract: (o) => traffic(o).days.map((d) => ({ date: d.date, value: d.sessions })) },
  { key: 'new_visitors', label: 'New visitors', unit: 'count', kind: 'daily', stage: 'visitor', capabilityId: 'analytics.traffic.read', provider: 'ga4', higherIsBetter: true, extract: (o) => traffic(o).days.map((d) => ({ date: d.date, value: d.newUsers })) },
  { key: 'total_visitors', label: 'Total visitors', unit: 'count', kind: 'daily', stage: 'visitor', capabilityId: 'analytics.traffic.read', provider: 'ga4', higherIsBetter: true, extract: (o) => traffic(o).days.map((d) => ({ date: d.date, value: d.users })) },
  { key: 'ai_clicks', label: 'AI clicks', unit: 'count', kind: 'daily', stage: 'visitor', capabilityId: 'analytics.traffic.read', provider: 'ga4', higherIsBetter: true, extract: (o) => traffic(o).days.map((d) => ({ date: d.date, value: d.aiClicks ?? 0 })) },
  { key: 'page_views', label: 'Page views', unit: 'count', kind: 'daily', capabilityId: 'analytics.traffic.read', provider: 'ga4', higherIsBetter: true, extract: (o) => traffic(o).days.map((d) => ({ date: d.date, value: d.pageViews })) },
  { key: 'search_clicks', label: 'Search clicks', unit: 'count', kind: 'daily', capabilityId: 'search.performance.read', provider: 'gsc', higherIsBetter: true, extract: (o) => search(o).days.map((d) => ({ date: d.date, value: d.clicks })) },
  { key: 'search_impressions', label: 'Search impressions', unit: 'count', kind: 'daily', capabilityId: 'search.performance.read', provider: 'gsc', higherIsBetter: true, extract: (o) => search(o).days.map((d) => ({ date: d.date, value: d.impressions })) },
  { key: 'leads_new', label: 'New leads', unit: 'count', kind: 'daily', stage: 'lead', capabilityId: 'email.audience.read', provider: 'brevo', higherIsBetter: true, extract: (o) => email(o).days.map((d) => ({ date: d.date, value: d.newContacts })) },
  { key: 'contacts_total', label: 'Email contacts', unit: 'count', kind: 'snapshot', stage: 'lead', capabilityId: 'email.audience.read', provider: 'brevo', higherIsBetter: true, extract: (o, today) => [{ date: today, value: email(o).totalContacts }] },
  // Fed by signed first-party events, not a provider capability (see metrics/sync.ts).
  { key: 'users_new', label: 'New users', unit: 'count', kind: 'daily', stage: 'user', capabilityId: 'internal.events.signups', provider: 'signups', higherIsBetter: true, extract: () => [] },
  { key: 'revenue_net', label: 'Net revenue', unit: 'money', kind: 'daily', capabilityId: 'payments.revenue.read', provider: 'stripe', higherIsBetter: true, extract: (o) => revenue(o).days.map((d) => moneyPoint(d.date, d.net)) },
  { key: 'subscriber_revenue', label: 'Subscriber revenue', unit: 'money', kind: 'daily', stage: 'subscriber', capabilityId: 'payments.revenue.read', provider: 'stripe', higherIsBetter: true, extract: (o) => revenue(o).days.map((d) => moneyPoint(d.date, d.subscriberRevenue ?? {})) },
  { key: 'ad_revenue', label: 'Ad revenue', unit: 'money', kind: 'daily', capabilityId: 'ads.revenue.read', provider: 'adsense', higherIsBetter: true, extract: (o) => ads(o).days.map((d) => moneyPoint(d.date, { [ads(o).currency]: d.earnings })) },
  { key: 'payments', label: 'Payments', unit: 'count', kind: 'daily', stage: 'customer', capabilityId: 'payments.revenue.read', provider: 'stripe', higherIsBetter: true, extract: (o) => revenue(o).days.map((d) => ({ date: d.date, value: d.payments })) },
  { key: 'customers_new', label: 'New customers', unit: 'count', kind: 'daily', stage: 'customer', capabilityId: 'payments.revenue.read', provider: 'stripe', higherIsBetter: true, extract: (o) => revenue(o).days.map((d) => ({ date: d.date, value: d.newCustomers })) },
  { key: 'subscribers_active', label: 'Active subscribers', unit: 'count', kind: 'snapshot', stage: 'subscriber', capabilityId: 'payments.revenue.read', provider: 'stripe', higherIsBetter: true, extract: (o, today) => [{ date: today, value: revenue(o).activeSubscriptions }] },
  { key: 'mrr', label: 'MRR', unit: 'money', kind: 'snapshot', stage: 'subscriber', capabilityId: 'payments.revenue.read', provider: 'stripe', higherIsBetter: true, extract: (o, today) => [moneyPoint(today, revenue(o).mrr)] },
  { key: 'yrr', label: 'YRR', unit: 'money', kind: 'snapshot', stage: 'subscriber', capabilityId: 'payments.revenue.read', provider: 'stripe', higherIsBetter: true, extract: (o, today) => [moneyPoint(today, Object.fromEntries(Object.entries(revenue(o).mrr).map(([currency, amount]) => [currency, amount * 12])))] },
  { key: 'cash_available', label: 'Cash available', unit: 'money', kind: 'snapshot', capabilityId: 'finance.cash.read', provider: 'mercury', higherIsBetter: true, sensitive: true, extract: (o, today) => [{ date: today, value: Math.round(cash(o).totalAvailable * 100) }] },
];

export function getMetric(key: string): MetricDefinition | undefined {
  return METRICS.find((m) => m.key === key);
}

/** Capabilities to run for a sync, and whether each takes a day window. */
export const SYNC_CAPABILITIES: { capabilityId: string; provider: string; windowed: boolean }[] = [
  { capabilityId: 'analytics.traffic.read', provider: 'ga4', windowed: true },
  { capabilityId: 'search.performance.read', provider: 'gsc', windowed: true },
  { capabilityId: 'email.audience.read', provider: 'brevo', windowed: true },
  { capabilityId: 'payments.revenue.read', provider: 'stripe', windowed: true },
  { capabilityId: 'ads.revenue.read', provider: 'adsense', windowed: true },
  { capabilityId: 'finance.cash.read', provider: 'mercury', windowed: false },
];
