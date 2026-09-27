import { Types } from 'mongoose';
import { ExternalResource, IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { sealSecret } from '@/lib/security/secretBox';
import { domainFromProject } from '@/lib/companies/ownedCompanies';
import { isCompanyManager, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface Ga4Property {
  id: string;
  displayName: string;
  hosts: string[];
}
export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

const TIMEOUT_MS = 15_000;

async function googleJson<T>(fetchImpl: FetchLike, url: string, accessToken: string): Promise<T> {
  const res = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google API ${new URL(url).hostname} returned ${res.status}`);
  return (await res.json()) as T;
}

function hostOf(uri: string | undefined): string | undefined {
  return uri ? domainFromProject({ url: uri }) : undefined;
}

export async function listGa4Properties(fetchImpl: FetchLike, accessToken: string): Promise<Ga4Property[]> {
  const summaries = await googleJson<{
    accountSummaries?: { propertySummaries?: { property: string; displayName: string }[] }[];
  }>(fetchImpl, 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', accessToken);
  const properties = (summaries.accountSummaries ?? []).flatMap((a) => a.propertySummaries ?? []).slice(0, 100);
  const out: Ga4Property[] = [];
  for (const p of properties) {
    const id = p.property.replace(/^properties\//, '');
    const streams = await googleJson<{ dataStreams?: { webStreamData?: { defaultUri?: string } }[] }>(
      fetchImpl,
      `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(id)}/dataStreams`,
      accessToken
    ).catch(() => ({ dataStreams: [] }));
    const hosts = (streams.dataStreams ?? []).map((s) => hostOf(s.webStreamData?.defaultUri)).filter((h): h is string => Boolean(h));
    out.push({ id, displayName: p.displayName, hosts: [...new Set(hosts)] });
  }
  return out;
}

export async function listGscSites(fetchImpl: FetchLike, accessToken: string): Promise<GscSite[]> {
  const data = await googleJson<{ siteEntry?: GscSite[] }>(fetchImpl, 'https://www.googleapis.com/webmasters/v3/sites', accessToken);
  return (data.siteEntry ?? []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
}

export function matchGa4Property(domain: string, properties: Ga4Property[]): Ga4Property | undefined {
  const matches = properties.filter((p) => p.hosts.includes(domain));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Prefers the domain property (covers all subdomains/protocols) over URL-prefix properties. */
export function matchGscSite(domain: string, sites: GscSite[]): GscSite | undefined {
  return (
    sites.find((s) => s.siteUrl === `sc-domain:${domain}`) ??
    sites.find((s) => s.siteUrl === `https://${domain}/`) ??
    sites.find((s) => s.siteUrl === `https://www.${domain}/`)
  );
}

export interface GoogleConnectSummary {
  accountEmail: string;
  analytics: { granted: boolean; connected: string[]; unmatched: string[] };
  searchConsole: { granted: boolean; connected: string[]; unmatched: string[] };
}

export type GoogleConnectResult = { ok: true; summary: GoogleConnectSummary } | { ok: false; error: string };

/**
 * Completes a Google sign-in: stores one refresh token for the Google account, then connects the
 * GA4 and Search Console integrations of every company whose production domain matches a property
 * or site that account can see. Unmatched companies keep their status with an explanatory note.
 */
export async function completeGoogleConnection(
  viewer: CompanyViewer,
  input: { code: string; redirectUri: string },
  fetchImpl: FetchLike = fetch
): Promise<GoogleConnectResult> {
  if (!isCompanyManager(viewer)) return { ok: false, error: 'Only managers can connect integrations.' };
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { ok: false, error: 'Google sign-in is not configured.' };

  const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tokenRes.ok) return { ok: false, error: 'Google did not accept the sign-in. Please try again.' };
  const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!tokens.access_token || !tokens.refresh_token) {
    return { ok: false, error: 'Google did not grant offline access. Please try again and approve all requested access.' };
  }
  const granted = new Set((tokens.scope ?? '').split(' '));
  const analyticsGranted = granted.has('https://www.googleapis.com/auth/analytics.readonly');
  const searchGranted = granted.has('https://www.googleapis.com/auth/webmasters.readonly');
  if (!analyticsGranted && !searchGranted) {
    return { ok: false, error: 'Neither Analytics nor Search Console access was granted.' };
  }

  const userinfo = await googleJson<{ email?: string }>(fetchImpl, 'https://openidconnect.googleapis.com/v1/userinfo', tokens.access_token).catch(
    () => ({ email: undefined })
  );
  const accountEmail = userinfo.email ?? 'Google account';

  let properties: Ga4Property[] = [];
  let sites: GscSite[] = [];
  try {
    if (analyticsGranted) properties = await listGa4Properties(fetchImpl, tokens.access_token);
    if (searchGranted) sites = await listGscSites(fetchImpl, tokens.access_token);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return { ok: false, error: `Signed in, but listing properties failed (${message}). Check that the Analytics Admin and Search Console APIs are enabled.` };
  }

  // One secret per Google account; re-signing in with the same account rotates it in place.
  const sealed = sealSecret('integration:google', tokens.refresh_token);
  const secret = await IntegrationSecret.findOneAndUpdate(
    { organizationId: viewer.organizationId, provider: 'google', hint: accountEmail },
    {
      $set: { sealed, rotatedAt: new Date() },
      $setOnInsert: { createdByUserId: new Types.ObjectId(viewer.userId) },
    },
    { upsert: true, new: true }
  ).select('_id');

  const companies = await listCompanyProfiles({ ...viewer, role: 'Administrator' });
  const summary: GoogleConnectSummary = {
    accountEmail,
    analytics: { granted: analyticsGranted, connected: [], unmatched: [] },
    searchConsole: { granted: searchGranted, connected: [], unmatched: [] },
  };

  for (const company of companies) {
    const companyObjectId = new Types.ObjectId(company.id);
    const targets: { provider: 'ga4' | 'gsc'; granted: boolean; bucket: GoogleConnectSummary['analytics'] }[] = [
      { provider: 'ga4', granted: analyticsGranted, bucket: summary.analytics },
      { provider: 'gsc', granted: searchGranted, bucket: summary.searchConsole },
    ];
    for (const target of targets) {
      if (!target.granted) continue;
      const connection = await IntegrationConnection.findOne({
        organizationId: viewer.organizationId,
        companyId: companyObjectId,
        provider: target.provider,
      })
        .select('_id status')
        .lean<{ _id: Types.ObjectId; status: string }>();
      if (!connection) continue;

      const match =
        company.domain && target.provider === 'ga4'
          ? (() => {
              const p = matchGa4Property(company.domain!, properties);
              return p ? { externalId: p.id, label: p.displayName, resourceType: 'property' } : undefined;
            })()
          : company.domain
            ? (() => {
                const s = matchGscSite(company.domain!, sites);
                return s ? { externalId: s.siteUrl, label: s.siteUrl, resourceType: 'site' } : undefined;
              })()
            : undefined;

      if (!match) {
        target.bucket.unmatched.push(company.name);
        if (connection.status !== 'connected') {
          const note = company.domain
            ? `${accountEmail} has no ${target.provider === 'ga4' ? 'Analytics property' : 'Search Console site'} for ${company.domain}.`
            : 'Set a production domain so a property can be matched.';
          await IntegrationConnection.updateOne({ _id: connection._id }, { $set: { lastError: note } });
        }
        continue;
      }

      await IntegrationConnection.updateOne(
        { _id: connection._id },
        {
          $set: {
            status: 'connected',
            secretId: secret._id,
            credentialHint: accountEmail,
            accountLabel: match.label,
            planLimited: false,
            grantedScopes: [...granted].filter((s) => s.startsWith('https://')),
            connectedByUserId: new Types.ObjectId(viewer.userId),
            lastVerifiedAt: new Date(),
          },
          $unset: { lastError: '', planLabel: '' },
          $inc: { revision: 1 },
        }
      );
      await ExternalResource.updateOne(
        { organizationId: viewer.organizationId, provider: target.provider, resourceType: match.resourceType, externalId: match.externalId },
        {
          $set: {
            companyId: companyObjectId,
            label: match.label,
            canonicalType: 'Company',
            canonicalId: companyObjectId,
            lastSyncedAt: new Date(),
          },
        },
        { upsert: true }
      );
      target.bucket.connected.push(company.name);
    }
  }

  return { ok: true, summary };
}
