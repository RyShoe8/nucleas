import { Types } from 'mongoose';
import { ExternalResource, IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { openSecret } from '@/lib/security/secretBox';
import { getCompanyProfile, isCompanyManager, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { listGa4Properties, listGscSites } from '@/lib/integrations/google/connectGoogle';
import { refreshGoogleAccessToken } from '@/lib/capabilities/adapters/google';
import { listAhrefsProjects } from '@/lib/capabilities/adapters/ahrefs';
import { listAdSenseSites } from '@/lib/capabilities/adapters/adsense';
import { CapabilityError, type CapabilityRunContext } from '@/lib/capabilities/types';

/**
 * Lets a manager pin which provider resource (GA4 property, Search Console site, Ahrefs project)
 * belongs to a company when domain matching couldn't decide. Candidates come only from what a
 * connected account can actually see; a pin is validated against that list.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const PINNABLE: Record<string, { resourceType: string; secretProvider: string; noun: string }> = {
  ga4: { resourceType: 'property', secretProvider: 'google', noun: 'Analytics property' },
  gsc: { resourceType: 'site', secretProvider: 'google', noun: 'Search Console site' },
  ahrefs: { resourceType: 'project', secretProvider: 'ahrefs', noun: 'Ahrefs project' },
  adsense: { resourceType: 'site', secretProvider: 'google', noun: 'AdSense site' },
};

export interface PinCandidate {
  externalId: string;
  label: string;
  detail?: string;
  /** Company this resource is currently pinned to, if any. */
  pinnedTo?: { companyId: string; name: string };
}

export interface PinAccount {
  secretId: string;
  accountHint: string;
  candidates: PinCandidate[];
  error?: string;
}

export interface PinOptions {
  provider: string;
  noun: string;
  pinned?: { externalId: string; label?: string };
  accounts: PinAccount[];
}

async function candidatesFor(provider: string, credential: string, fetchImpl: FetchLike): Promise<Omit<PinCandidate, 'pinnedTo'>[]> {
  if (provider === 'adsense') {
    const token = await refreshGoogleAccessToken(credential, fetchImpl);
    return (await listAdSenseSites(fetchImpl, token)).map((s) => ({ externalId: s.name, label: s.domain, detail: s.account.replace('accounts/', '') }));
  }
  if (provider === 'ga4' || provider === 'gsc') {
    const token = await refreshGoogleAccessToken(credential, fetchImpl);
    if (provider === 'ga4') {
      return (await listGa4Properties(fetchImpl, token)).map((p) => ({ externalId: p.id, label: p.displayName, detail: p.hosts.join(', ') || undefined }));
    }
    return (await listGscSites(fetchImpl, token)).map((s) => ({ externalId: s.siteUrl, label: s.siteUrl, detail: s.permissionLevel }));
  }
  const ctx = { access: { credential }, fetch: fetchImpl } as unknown as CapabilityRunContext;
  return (await listAhrefsProjects(ctx)).map((p) => ({ externalId: String(p.project_id), label: p.project_name, detail: p.url }));
}

function errorText(err: unknown): string {
  if (err instanceof CapabilityError) return err.message;
  return err instanceof Error ? err.message.slice(0, 200) : 'Could not list resources.';
}

export async function listPinOptions(viewer: CompanyViewer, companyId: string, provider: string, fetchImpl: FetchLike = fetch): Promise<PinOptions | null> {
  const spec = PINNABLE[provider];
  if (!spec || !isCompanyManager(viewer)) return null;
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;

  const pinned = await ExternalResource.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId), provider, resourceType: spec.resourceType })
    .select('externalId label')
    .lean<{ externalId: string; label?: string }>();

  const secrets = await IntegrationSecret.find({ organizationId: viewer.organizationId, provider: spec.secretProvider }).select('+sealed hint').lean<
    { _id: Types.ObjectId; sealed: string; hint?: string }[]
  >();

  const existingPins = await ExternalResource.find({ organizationId: viewer.organizationId, provider, resourceType: spec.resourceType })
    .select('externalId companyId')
    .lean<{ externalId: string; companyId: Types.ObjectId }[]>();
  // Resolved names (hub project for owned companies), never the stale copied Client name.
  const names = new Map((await listCompanyProfiles({ ...viewer, role: 'Administrator' })).map((c) => [c.id, c.name]));
  const pinMap = new Map(existingPins.map((p) => [p.externalId, { companyId: String(p.companyId), name: names.get(String(p.companyId)) ?? 'another company' }]));

  const accounts: PinAccount[] = [];
  for (const secret of secrets) {
    const account: PinAccount = { secretId: String(secret._id), accountHint: secret.hint ?? spec.secretProvider, candidates: [] };
    try {
      const credential = openSecret(`integration:${spec.secretProvider}`, secret.sealed);
      account.candidates = (await candidatesFor(provider, credential, fetchImpl))
        .map((c) => {
          const owner = pinMap.get(c.externalId);
          return owner && owner.companyId !== companyId ? { ...c, pinnedTo: owner } : c;
        })
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (err) {
      account.error = errorText(err);
    }
    accounts.push(account);
  }
  return { provider, noun: spec.noun, pinned: pinned ?? undefined, accounts };
}

export type PinResult = { ok: true; label: string } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

export async function pinResource(
  viewer: CompanyViewer,
  companyId: string,
  provider: string,
  input: { secretId: string; externalId: string; move?: boolean },
  fetchImpl: FetchLike = fetch
): Promise<PinResult> {
  const spec = PINNABLE[provider];
  if (!spec) return { ok: false, status: 400, error: 'This integration has nothing to pin.' };
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers can change integrations.' };
  const options = await listPinOptions(viewer, companyId, provider, fetchImpl);
  if (!options) return { ok: false, status: 404, error: 'Company not found.' };

  const account = options.accounts.find((a) => a.secretId === input.secretId);
  const candidate = account?.candidates.find((c) => c.externalId === input.externalId);
  if (!account || !candidate) return { ok: false, status: 400, error: `That ${spec.noun} is not visible to the connected account.` };
  if (candidate.pinnedTo && !input.move) {
    return { ok: false, status: 409, error: `Already pinned to ${candidate.pinnedTo.name}. Confirm to move it here.` };
  }

  const companyObjectId = new Types.ObjectId(companyId);
  // One pinned resource per company/provider: drop the previous pin, then claim this one.
  await ExternalResource.deleteMany({
    organizationId: viewer.organizationId,
    companyId: companyObjectId,
    provider,
    resourceType: spec.resourceType,
    externalId: { $ne: candidate.externalId },
  });
  await ExternalResource.updateOne(
    { organizationId: viewer.organizationId, provider, resourceType: spec.resourceType, externalId: candidate.externalId },
    { $set: { companyId: companyObjectId, label: candidate.label, canonicalType: 'Company', canonicalId: companyObjectId, lastSyncedAt: new Date() } },
    { upsert: true }
  );

  // Company-scoped connections adopt the chosen account; shared (org) accounts stay as they are.
  if (spec.secretProvider === 'google') {
    // Google-backed integrations (GA4, Search Console, AdSense) adopt the chosen Google account.
    await IntegrationConnection.updateOne(
      { organizationId: viewer.organizationId, companyId: companyObjectId, provider },
      {
        $set: {
          status: 'connected',
          secretId: new Types.ObjectId(account.secretId),
          credentialHint: account.accountHint,
          accountLabel: candidate.label,
          connectedByUserId: new Types.ObjectId(viewer.userId),
          lastVerifiedAt: new Date(),
        },
        $setOnInsert: { scope: 'company', source: 'manual', grantedScopes: [] },
        $unset: { lastError: '' },
        $inc: { revision: 1 },
      },
      { upsert: true }
    );
  }
  return { ok: true, label: candidate.label };
}
