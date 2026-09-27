import { Types } from 'mongoose';
import { IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { openSecret, sealSecret, secretHint } from '@/lib/security/secretBox';
import { getIntegrationProvider } from '@/lib/integrations/providers';
import { verifyCredential, type VerifyOutcome } from '@/lib/integrations/verifyCredential';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';

/** Client-safe connection view. Never includes secret material or secret ids. */
export interface ConnectionView {
  id: string;
  provider: string;
  providerName: string;
  domain: string;
  scope: 'org' | 'company';
  companyId: string | null;
  status: string;
  credentialHint?: string;
  accountLabel?: string;
  planLabel?: string;
  planLimited: boolean;
  lastVerifiedAt?: string;
  lastError?: string;
  connectable: boolean;
}

type ConnectionLean = {
  _id: Types.ObjectId;
  provider: string;
  scope: 'org' | 'company';
  companyId?: Types.ObjectId | null;
  status: string;
  credentialHint?: string;
  accountLabel?: string;
  planLabel?: string;
  planLimited?: boolean;
  lastVerifiedAt?: Date;
  lastError?: string;
};

function toView(c: ConnectionLean): ConnectionView {
  const def = getIntegrationProvider(c.provider);
  return {
    id: String(c._id),
    provider: c.provider,
    providerName: def?.name ?? c.provider,
    domain: def?.domain ?? 'other',
    scope: c.scope,
    companyId: c.companyId ? String(c.companyId) : null,
    status: c.status,
    credentialHint: c.credentialHint,
    accountLabel: c.accountLabel,
    planLabel: c.planLabel,
    planLimited: Boolean(c.planLimited),
    lastVerifiedAt: c.lastVerifiedAt?.toISOString(),
    lastError: c.lastError,
    connectable: def?.authKind === 'api_key',
  };
}

const VIEW_FIELDS = 'provider scope companyId status credentialHint accountLabel planLabel planLimited lastVerifiedAt lastError';

/** Company connections plus the org-wide accounts that serve it. */
export async function listCompanyConnections(viewer: CompanyViewer, companyId: string): Promise<ConnectionView[] | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  const rows = await IntegrationConnection.find({
    organizationId: viewer.organizationId,
    $or: [{ companyId: new Types.ObjectId(companyId) }, { companyId: null }],
  })
    .select(VIEW_FIELDS)
    .lean<ConnectionLean[]>();
  return rows.map(toView).sort((a, b) => a.domain.localeCompare(b.domain) || a.providerName.localeCompare(b.providerName));
}

export type ConnectResult =
  | { ok: true; connection: ConnectionView }
  | { ok: false; status: 400 | 403 | 404 | 422 | 502; error: string };

/**
 * Verifies and stores an API credential for a declared connection. Managers only.
 * The credential is verified before anything is written; failures store nothing.
 */
export async function connectWithApiKey(
  viewer: CompanyViewer,
  connectionId: string,
  credential: string,
  verify: (provider: string, credential: string) => Promise<VerifyOutcome> = verifyCredential
): Promise<ConnectResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers can connect integrations.' };
  if (!Types.ObjectId.isValid(connectionId)) return { ok: false, status: 404, error: 'Connection not found.' };

  const connection = await IntegrationConnection.findOne({ _id: connectionId, organizationId: viewer.organizationId })
    .select(`${VIEW_FIELDS} secretId revision`)
    .lean<ConnectionLean & { secretId?: Types.ObjectId; revision: number }>();
  if (!connection) return { ok: false, status: 404, error: 'Connection not found.' };
  if (connection.companyId && !(await getCompanyProfile(viewer, String(connection.companyId)))) {
    return { ok: false, status: 404, error: 'Connection not found.' };
  }
  if (getIntegrationProvider(connection.provider)?.authKind !== 'api_key') {
    return { ok: false, status: 400, error: 'This integration is not connected with an API key.' };
  }
  if (typeof credential !== 'string' || !credential.trim() || credential.length > 500) {
    return { ok: false, status: 400, error: 'Enter a valid credential.' };
  }

  const outcome = await verify(connection.provider, credential);
  if (!outcome.ok) {
    return { ok: false, status: outcome.reason === 'unreachable' ? 502 : 422, error: outcome.message };
  }

  const sealed = sealSecret(`integration:${connection.provider}`, credential.trim());
  const hint = secretHint(credential);
  let secretId = connection.secretId;
  if (secretId) {
    await IntegrationSecret.updateOne({ _id: secretId, organizationId: viewer.organizationId }, { $set: { sealed, hint, rotatedAt: new Date() } });
  } else {
    const secret = await IntegrationSecret.create({
      organizationId: viewer.organizationId,
      provider: connection.provider,
      sealed,
      hint,
      createdByUserId: new Types.ObjectId(viewer.userId),
    });
    secretId = secret._id;
  }

  const updated = await IntegrationConnection.findOneAndUpdate(
    { _id: connection._id, revision: connection.revision },
    {
      $set: {
        status: 'connected',
        secretId,
        credentialHint: hint,
        accountLabel: outcome.accountLabel,
        planLabel: outcome.planLabel,
        planLimited: Boolean(outcome.planLimited),
        connectedByUserId: new Types.ObjectId(viewer.userId),
        lastVerifiedAt: new Date(),
      },
      $unset: { lastError: '' },
      $inc: { revision: 1 },
    },
    { new: true }
  )
    .select(VIEW_FIELDS)
    .lean<ConnectionLean>();
  if (!updated) return { ok: false, status: 422, error: 'Connection changed while saving. Try again.' };
  return { ok: true, connection: toView(updated) };
}

/** Server-side only: decrypts a connection's credential for an executor. Never expose to clients or models. */
export async function readConnectionCredential(organizationId: Types.ObjectId, connectionId: Types.ObjectId): Promise<string | null> {
  const connection = await IntegrationConnection.findOne({ _id: connectionId, organizationId, status: 'connected' })
    .select('provider secretId')
    .lean<{ provider: string; secretId?: Types.ObjectId }>();
  if (!connection?.secretId) return null;
  const secret = await IntegrationSecret.findOne({ _id: connection.secretId, organizationId })
    .select('+sealed')
    .lean<{ sealed: string }>();
  return secret ? openSecret(`integration:${connection.provider}`, secret.sealed) : null;
}
