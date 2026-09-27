import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { CapabilityApproval, CapabilityInvocation } from '@/lib/models/Capability';
import { ExternalResource, IntegrationConnection } from '@/lib/models/Integration';
import { readConnectionCredential } from '@/lib/integrations/connections';
import { getIntegrationProvider } from '@/lib/integrations/providers';
import { getCompanyProfile, isCompanyManager, type CompanyProfile, type CompanyViewer } from '@/lib/companies/companyProfile';
import { CAPABILITIES, getCapability } from './registry';
import { CapabilityError, type CapabilityDefinition, type InvocationStatus, type ProviderAccess } from './types';

/**
 * The single path for every capability invocation (UI today, AI later):
 * validate → authorize → resolve connection + pinned resource → policy/approval → execute →
 * verify (writes) → receipt. Adapters never see the viewer; the viewer never sees credentials.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface InvokeOptions {
  aiRunId?: string;
  /** Set for scheduled system work, e.g. 'metrics-sync'. */
  system?: string;
  fetchImpl?: FetchLike;
  registry?: CapabilityDefinition[];
  now?: Date;
}

export interface InvocationView {
  id: string;
  capabilityId: string;
  title: string;
  kind: 'read' | 'write';
  risk: string;
  provider: string;
  providerName: string;
  status: InvocationStatus;
  summary?: string;
  error?: string;
  output?: unknown;
  resource?: { resourceType?: string; externalId?: string; label?: string; externalUrl?: string };
  verified?: boolean;
  providerUnits: number;
  approvalId?: string;
  requestedBy: 'user' | 'ai' | 'system';
  createdAt: string;
  finishedAt?: string;
  cached?: boolean;
}

export type InvokeResult =
  | { ok: true; invocation: InvocationView }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const MAX_OUTPUT_BYTES = 200_000;
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function inputDigest(capabilityId: string, version: number, input: unknown): string {
  return createHash('sha256').update(stableStringify({ capabilityId, version, input })).digest('hex');
}

type InvocationLean = {
  _id: Types.ObjectId;
  capabilityId: string;
  kind: 'read' | 'write';
  risk: string;
  provider: string;
  status: InvocationStatus;
  summary?: string;
  error?: string;
  output?: unknown;
  resource?: InvocationView['resource'];
  verified?: boolean;
  providerUnits?: number;
  approvalId?: Types.ObjectId;
  requestedByAiRunId?: Types.ObjectId;
  requestedBySystem?: string;
  createdAt: Date;
  finishedAt?: Date;
};

export function toInvocationView(doc: InvocationLean, registry: CapabilityDefinition[] = CAPABILITIES, cached = false): InvocationView {
  return {
    id: String(doc._id),
    capabilityId: doc.capabilityId,
    title: getCapability(doc.capabilityId, registry)?.title ?? doc.capabilityId,
    kind: doc.kind,
    risk: doc.risk,
    provider: doc.provider,
    providerName: getIntegrationProvider(doc.provider)?.name ?? doc.provider,
    status: doc.status,
    summary: doc.summary,
    error: doc.error,
    output: doc.output,
    resource: doc.resource?.externalId ? doc.resource : undefined,
    verified: doc.verified,
    providerUnits: doc.providerUnits ?? 0,
    approvalId: doc.approvalId ? String(doc.approvalId) : undefined,
    requestedBy: doc.requestedBySystem ? 'system' : doc.requestedByAiRunId ? 'ai' : 'user',
    createdAt: doc.createdAt.toISOString(),
    finishedAt: doc.finishedAt?.toISOString(),
    ...(cached ? { cached: true } : {}),
  };
}

async function finish(id: Types.ObjectId, status: InvocationStatus, fields: Record<string, unknown> = {}) {
  return CapabilityInvocation.findByIdAndUpdate(id, { $set: { status, finishedAt: new Date(), ...fields } }, { new: true }).lean<InvocationLean>();
}

/** Resolves the connection (company first, then shared org account) and the company's pinned resource. */
async function resolveAccess(
  viewer: CompanyViewer,
  profile: CompanyProfile,
  def: CapabilityDefinition
): Promise<{ access: ProviderAccess } | { status: 'needs_setup' | 'needs_reauth' | 'plan_limited'; error: string }> {
  const providerName = getIntegrationProvider(def.provider)?.name ?? def.provider;
  const companyId = new Types.ObjectId(profile.id);
  const connection =
    (await IntegrationConnection.findOne({ organizationId: viewer.organizationId, companyId, provider: def.provider, status: { $ne: 'disabled' } })
      .select('status planLimited')
      .lean<{ _id: Types.ObjectId; status: string; planLimited?: boolean }>()) ??
    (await IntegrationConnection.findOne({ organizationId: viewer.organizationId, companyId: null, provider: def.provider, status: { $ne: 'disabled' } })
      .select('status planLimited')
      .lean<{ _id: Types.ObjectId; status: string; planLimited?: boolean }>());

  if (!connection || connection.status === 'declared') return { status: 'needs_setup', error: `Connect ${providerName} for ${profile.name} first.` };
  if (connection.status === 'needs_reauth' || connection.status === 'error') return { status: 'needs_reauth', error: `Reconnect ${providerName}.` };
  if (connection.planLimited) return { status: 'plan_limited', error: `The current ${providerName} plan does not include this.` };

  let resource: ProviderAccess['resource'];
  if (def.requiresResource) {
    const pinned = await ExternalResource.findOne({
      organizationId: viewer.organizationId,
      companyId,
      provider: def.provider,
      resourceType: def.requiresResource,
    })
      .select('externalId label')
      .lean<{ externalId: string; label?: string }>();
    // Never fall back to "first"/"all" resources the credential can see.
    if (!pinned) return { status: 'needs_setup', error: `No ${providerName} ${def.requiresResource} is pinned to ${profile.name}.` };
    resource = { externalId: pinned.externalId, label: pinned.label };
  }

  const credential = await readConnectionCredential(viewer.organizationId, connection._id);
  if (!credential) return { status: 'needs_reauth', error: `Reconnect ${providerName}.` };
  return { access: { provider: def.provider, connectionId: connection._id, credential, resource } };
}

async function execute(
  viewer: CompanyViewer,
  profile: CompanyProfile,
  def: CapabilityDefinition,
  invocationId: Types.ObjectId,
  input: unknown,
  fetchImpl: FetchLike,
  now: Date
): Promise<InvocationLean> {
  const resolved = await resolveAccess(viewer, profile, def);
  if (!('access' in resolved)) return (await finish(invocationId, resolved.status, { error: resolved.error }))!;

  await CapabilityInvocation.updateOne({ _id: invocationId }, { $set: { status: 'running', startedAt: new Date() } });
  let units = 0;
  const ctx = {
    organizationId: viewer.organizationId,
    companyId: new Types.ObjectId(profile.id),
    companyDomain: profile.domain,
    access: resolved.access,
    now,
    fetch: fetchImpl,
    reportUnits: (n: number) => {
      units += n;
    },
  };

  try {
    const result = await def.run(ctx, input);
    let verified: boolean | undefined;
    if (def.kind === 'write' && def.verify) verified = await def.verify(ctx, input, result);

    if (def.kind === 'write' && result.resource) {
      await ExternalResource.updateOne(
        { organizationId: viewer.organizationId, provider: def.provider, resourceType: result.resource.resourceType, externalId: result.resource.externalId },
        {
          $set: {
            companyId: ctx.companyId,
            label: result.resource.label,
            externalUrl: result.resource.externalUrl,
            canonicalType: 'Company',
            canonicalId: ctx.companyId,
            lastSyncedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }

    const serialized = JSON.stringify(result.output ?? null);
    const status: InvocationStatus = def.kind === 'write' ? (verified === false ? 'failed' : verified ? 'verified' : 'succeeded') : 'succeeded';
    return (await finish(invocationId, status, {
      output: serialized.length <= MAX_OUTPUT_BYTES ? result.output : null,
      summary: result.summary,
      resource: result.resource,
      verified,
      providerUnits: units,
      ...(verified === false ? { error: 'The provider did not confirm the change on read-back.' } : {}),
    }))!;
  } catch (err) {
    if (err instanceof CapabilityError) {
      if (err.code === 'needs_reauth') {
        await IntegrationConnection.updateOne({ _id: resolved.access.connectionId }, { $set: { status: 'needs_reauth', lastError: err.message } });
      }
      if (err.code === 'plan_limited') {
        await IntegrationConnection.updateOne({ _id: resolved.access.connectionId }, { $set: { planLimited: true } });
      }
      return (await finish(invocationId, err.code, { error: err.message, providerUnits: units }))!;
    }
    console.error('[capabilities] unexpected failure', def.id, err instanceof Error ? err.message : 'unknown');
    return (await finish(invocationId, 'failed', { error: 'Unexpected error while running this action.', providerUnits: units }))!;
  }
}

export async function invokeCapability(
  viewer: CompanyViewer,
  companyId: string,
  capabilityId: string,
  rawInput: unknown,
  options: InvokeOptions = {}
): Promise<InvokeResult> {
  const registry = options.registry ?? CAPABILITIES;
  const def = getCapability(capabilityId, registry);
  if (!def) return { ok: false, status: 404, error: 'Unknown capability.' };
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return { ok: false, status: 404, error: 'Company not found.' };
  if (def.kind === 'write' && !isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers can run actions that change things.' };

  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, status: 400, error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
  const input = parsed.data;
  const digest = inputDigest(def.id, def.version, input);
  const now = options.now ?? new Date();

  if (def.kind === 'read' && def.cacheSeconds) {
    const recent = await CapabilityInvocation.findOne({
      organizationId: viewer.organizationId,
      companyId: new Types.ObjectId(profile.id),
      capabilityId: def.id,
      inputDigest: digest,
      status: 'succeeded',
      finishedAt: { $gte: new Date(now.getTime() - def.cacheSeconds * 1000) },
    })
      .sort({ finishedAt: -1 })
      .lean<InvocationLean>();
    if (recent) return { ok: true, invocation: toInvocationView(recent, registry, true) };
  }

  const invocation = await CapabilityInvocation.create({
    organizationId: viewer.organizationId,
    companyId: new Types.ObjectId(profile.id),
    capabilityId: def.id,
    capabilityVersion: def.version,
    kind: def.kind,
    risk: def.risk,
    provider: def.provider,
    status: def.approval === 'required' ? 'pending_approval' : 'running',
    requestedByUserId: Types.ObjectId.isValid(viewer.userId) ? new Types.ObjectId(viewer.userId) : undefined,
    requestedByAiRunId: options.aiRunId ? new Types.ObjectId(options.aiRunId) : undefined,
    requestedBySystem: options.system,
    input,
    inputDigest: digest,
  });

  if (def.approval === 'required') {
    const approval = await CapabilityApproval.create({
      organizationId: viewer.organizationId,
      companyId: invocation.companyId,
      invocationId: invocation._id,
      capabilityId: def.id,
      inputDigest: digest,
      requestedByUserId: invocation.requestedByUserId,
      expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
    });
    const pending = await CapabilityInvocation.findByIdAndUpdate(invocation._id, { $set: { approvalId: approval._id } }, { new: true }).lean<InvocationLean>();
    return { ok: true, invocation: toInvocationView(pending!, registry) };
  }

  const done = await execute(viewer, profile, def, invocation._id, input, options.fetchImpl ?? fetch, now);
  return { ok: true, invocation: toInvocationView(done, registry) };
}

/**
 * Approve or deny one pending invocation. The approval is consumed atomically (once), rechecks
 * manager authority, expiry and the exact input digest, then runs the stored input.
 */
export async function decideApproval(
  viewer: CompanyViewer,
  approvalId: string,
  decision: 'approve' | 'deny',
  options: InvokeOptions = {}
): Promise<InvokeResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers can approve actions.' };
  if (!Types.ObjectId.isValid(approvalId)) return { ok: false, status: 404, error: 'Approval not found.' };
  const registry = options.registry ?? CAPABILITIES;
  const now = options.now ?? new Date();

  const approval = await CapabilityApproval.findOne({ _id: approvalId, organizationId: viewer.organizationId }).lean();
  if (!approval) return { ok: false, status: 404, error: 'Approval not found.' };
  const profile = await getCompanyProfile(viewer, String(approval.companyId));
  if (!profile) return { ok: false, status: 404, error: 'Approval not found.' };

  if (approval.status === 'pending' && approval.expiresAt <= now) {
    await CapabilityApproval.updateOne({ _id: approval._id, status: 'pending' }, { $set: { status: 'expired' } });
    await finish(approval.invocationId, 'cancelled', { error: 'Approval expired.' });
    return { ok: false, status: 409, error: 'This approval expired. Request the action again.' };
  }

  const consumed = await CapabilityApproval.findOneAndUpdate(
    { _id: approval._id, status: 'pending', expiresAt: { $gt: now } },
    { $set: { status: decision === 'approve' ? 'approved' : 'denied', decidedByUserId: new Types.ObjectId(viewer.userId), decidedAt: now } },
    { new: true }
  ).lean();
  if (!consumed) return { ok: false, status: 409, error: 'This approval was already decided.' };

  const invocation = await CapabilityInvocation.findOne({ _id: approval.invocationId, status: 'pending_approval' }).lean<
    InvocationLean & { input: unknown; inputDigest: string; capabilityVersion: number }
  >();
  if (!invocation) return { ok: false, status: 409, error: 'The action is no longer waiting for approval.' };

  if (decision === 'deny') {
    const denied = await finish(invocation._id, 'denied', { error: 'Denied by a manager.' });
    return { ok: true, invocation: toInvocationView(denied!, registry) };
  }

  const def = getCapability(invocation.capabilityId, registry);
  if (!def || def.version !== invocation.capabilityVersion || inputDigest(def.id, def.version, invocation.input) !== approval.inputDigest) {
    const stale = await finish(invocation._id, 'cancelled', { error: 'The action changed after it was requested. Request it again.' });
    return { ok: true, invocation: toInvocationView(stale!, registry) };
  }

  const done = await execute(viewer, profile, def, invocation._id, invocation.input, options.fetchImpl ?? fetch, new Date());
  return { ok: true, invocation: toInvocationView(done, registry) };
}

export async function listInvocations(
  viewer: CompanyViewer,
  companyId: string,
  options: { limit?: number; includeReads?: boolean; registry?: CapabilityDefinition[] } = {}
): Promise<InvocationView[] | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  const filter: Record<string, unknown> = { organizationId: viewer.organizationId, companyId: new Types.ObjectId(profile.id) };
  if (!options.includeReads) {
    filter.$or = [{ kind: 'write' }, { status: { $nin: ['succeeded', 'running'] } }];
  }
  const rows = await CapabilityInvocation.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(options.limit ?? 25, 1), 50))
    .select('-input -inputDigest')
    .lean<InvocationLean[]>();
  return rows.map((r) => toInvocationView({ ...r, output: undefined }, options.registry));
}
