import { CapabilityError, type CapabilityRunContext } from '../types';
import { providerJson } from './http';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Exchanges a Google refresh token for a short-lived access token. */
export async function refreshGoogleAccessToken(refreshToken: string, fetchImpl: FetchLike): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new CapabilityError('failed', 'Google sign-in is not configured.');
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (body.error === 'invalid_grant') throw new CapabilityError('needs_reauth', 'Google access was revoked or expired. Sign in with Google again.');
  if (!res.ok || !body.access_token) throw new CapabilityError('failed', 'Could not refresh Google access.');
  return body.access_token;
}

export function googleAccessToken(ctx: CapabilityRunContext): Promise<string> {
  return refreshGoogleAccessToken(ctx.access.credential, ctx.fetch);
}

export interface TrafficDay {
  date: string;
  sessions: number;
  users: number;
  newUsers: number;
  pageViews: number;
}
export interface TrafficOutput {
  propertyId: string;
  startDate: string;
  endDate: string;
  totals: Omit<TrafficDay, 'date'>;
  days: TrafficDay[];
  topChannels: { channel: string; sessions: number }[];
}

type RunReport = { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] };

export async function ga4Traffic(ctx: CapabilityRunContext, range: { startDate: string; endDate: string }): Promise<TrafficOutput> {
  const propertyId = ctx.access.resource!.externalId;
  const token = await googleAccessToken(ctx);
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const headers = { authorization: `Bearer ${token}` };

  const daily = await providerJson<RunReport>(
    ctx,
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dateRanges: [range],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 400,
      }),
    },
    'Google Analytics'
  );
  const channels = await providerJson<RunReport>(
    ctx,
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dateRanges: [range],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
    },
    'Google Analytics'
  );

  const days: TrafficDay[] = (daily.rows ?? []).map((r) => {
    const d = r.dimensionValues[0].value;
    const [sessions, users, newUsers, pageViews] = r.metricValues.map((m) => Number(m.value) || 0);
    return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, sessions, users, newUsers, pageViews };
  });
  const totals = days.reduce(
    (t, d) => ({ sessions: t.sessions + d.sessions, users: t.users + d.users, newUsers: t.newUsers + d.newUsers, pageViews: t.pageViews + d.pageViews }),
    { sessions: 0, users: 0, newUsers: 0, pageViews: 0 }
  );
  return {
    propertyId,
    ...range,
    // Daily users summed over a range over-counts returning visitors; labelled as such in the UI.
    totals,
    days,
    topChannels: (channels.rows ?? []).map((r) => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) || 0 })),
  };
}

export interface SearchOutput {
  siteUrl: string;
  startDate: string;
  endDate: string;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  days: { date: string; clicks: number; impressions: number }[];
  topQueries: { query: string; clicks: number; impressions: number; position: number }[];
}

type GscRows = { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] };

export async function gscPerformance(ctx: CapabilityRunContext, range: { startDate: string; endDate: string }): Promise<SearchOutput> {
  const siteUrl = ctx.access.resource!.externalId;
  const token = await googleAccessToken(ctx);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const headers = { authorization: `Bearer ${token}` };

  const byDate = await providerJson<GscRows>(ctx, url, { method: 'POST', headers, body: JSON.stringify({ ...range, dimensions: ['date'], rowLimit: 400 }) }, 'Search Console');
  const byQuery = await providerJson<GscRows>(ctx, url, { method: 'POST', headers, body: JSON.stringify({ ...range, dimensions: ['query'], rowLimit: 10 }) }, 'Search Console');
  const total = await providerJson<GscRows>(ctx, url, { method: 'POST', headers, body: JSON.stringify({ ...range, rowLimit: 1 }) }, 'Search Console');

  const t = total.rows?.[0];
  return {
    siteUrl,
    ...range,
    totals: {
      clicks: t?.clicks ?? 0,
      impressions: t?.impressions ?? 0,
      ctr: t ? Math.round(t.ctr * 10000) / 100 : 0,
      position: t ? Math.round(t.position * 10) / 10 : 0,
    },
    days: (byDate.rows ?? []).map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
    topQueries: (byQuery.rows ?? []).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 })),
  };
}
