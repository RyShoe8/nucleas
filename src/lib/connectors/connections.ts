import 'server-only';
import { Types } from 'mongoose';
import { z } from 'zod';
import { IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { ReleaseRoundup } from '@/lib/models/ReleaseRoundup';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { openSecret, sealSecret, secretHint } from '@/lib/security/secretBox';
import { websiteConnectorConfigSchema, type WebsiteConnectorConfig } from './contracts';
import { websiteAdapter } from './adapters';

export class WebsiteConnectionError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
export const connectorRolloutEnabled = () => process.env.NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED === 'true';
export interface WebsiteConnection {
  connectionId: string; revision: number; config: WebsiteConnectorConfig; credential: string;
}
export interface WebsiteConnectionView {
  companyId: string; canManage: boolean; rolloutAvailable: boolean;
  connection: { id: string; revision: number; config: WebsiteConnectorConfig; hasCredential: boolean; lastTestAt: string | null; testOk: boolean; testError: string | null } | null;
}
async function scopeFor(viewer: CompanyViewer, companyId: string) {
  if (!Types.ObjectId.isValid(companyId)) throw new WebsiteConnectionError('Company not found.', 404);
  const company = await getCompanyProfile(viewer, companyId);
  if (!company) throw new WebsiteConnectionError('Company not found.', 404);
  return { company, filter: { organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId), provider: 'website', scope: 'company' } };
}
async function credentialFor(viewer: CompanyViewer, secretId?: Types.ObjectId | null): Promise<string | null> {
  if (!secretId) return null;
  const secret = await IntegrationSecret.findOne({ _id: secretId, organizationId: viewer.organizationId, provider: 'website' }).select('+sealed').lean();
  return secret ? openSecret('integration:website', secret.sealed) : null;
}
export async function websiteConnectionView(viewer: CompanyViewer, companyId: string): Promise<WebsiteConnectionView> {
  const { filter } = await scopeFor(viewer, companyId);
  const row = await IntegrationConnection.findOne(filter).lean();
  const parsed = websiteConnectorConfigSchema.safeParse(row?.connectorConfig);
  return { companyId, canManage: isCompanyManager(viewer), rolloutAvailable: connectorRolloutEnabled(), connection: row && parsed.success ? {
    id: String(row._id), revision: row.revision ?? 0, config: parsed.data, hasCredential: Boolean(row.secretId),
    lastTestAt: row.connectorTest?.at?.toISOString() ?? null, testOk: Boolean(row.connectorTest?.ok && row.connectorTest?.revision === row.revision), testError: row.connectorTest?.error ?? null,
  } : null };
}
export async function getWebsiteConnection(viewer: CompanyViewer, companyId: string): Promise<WebsiteConnection | null> {
  const { filter } = await scopeFor(viewer, companyId);
  const row = await IntegrationConnection.findOne({ ...filter, status: 'connected' }).lean();
  const parsed = websiteConnectorConfigSchema.safeParse(row?.connectorConfig);
  if (!row || !parsed.success || !parsed.data.enabled || !row.connectorTest?.ok || row.connectorTest.revision !== row.revision) return null;
  const credential = await credentialFor(viewer, row.secretId);
  if (!credential) throw new WebsiteConnectionError('Reconnect the website publishing account.', 409);
  return { connectionId: String(row._id), revision: row.revision ?? 0, config: parsed.data, credential };
}
export async function getPinnedWebsiteConnection(viewer: CompanyViewer, companyId: string, binding: { connectionId?: string | null; revision?: number | null; origin?: string | null }): Promise<WebsiteConnection> {
  const selected = await getWebsiteConnection(viewer, companyId);
  if (!selected || selected.connectionId !== binding.connectionId || selected.revision !== binding.revision || selected.config.origin !== binding.origin) {
    throw new WebsiteConnectionError('This draft’s website connection changed or was paused. Restore its original connection before retrying; it will not be sent elsewhere.', 409);
  }
  return selected;
}
export const saveWebsiteSchema = z.object({
  config: websiteConnectorConfigSchema, credential: z.string().trim().min(16).max(4096).optional(), expectedRevision: z.number().int().min(0).optional(),
}).strict();
export async function saveWebsiteConnection(viewer: CompanyViewer, companyId: string, raw: unknown) {
  if (!isCompanyManager(viewer)) throw new WebsiteConnectionError('Only managers may configure website connections.', 403);
  const input = saveWebsiteSchema.parse(raw);
  const { company, filter } = await scopeFor(viewer, companyId);
  let companyOrigin: string;
  try { companyOrigin = new URL(company.domain?.includes('://') ? company.domain : `https://${company.domain}`).origin; }
  catch { throw new WebsiteConnectionError('Set the company website before configuring its connection.'); }
  if (input.config.origin !== companyOrigin) throw new WebsiteConnectionError('The connection must use this company’s website origin.');
  const row = await IntegrationConnection.findOne(filter).lean();
  if ((row?.revision ?? 0) !== (input.expectedRevision ?? 0)) throw new WebsiteConnectionError('Connection changed. Reload before saving.', 409);
  if (row && await ReleaseRoundup.exists({ organizationId: viewer.organizationId, companyId, active: true, 'transport.kind': 'connector', 'transport.connectionId': String(row._id) })) {
    // Pausing is allowed; redirecting a pending/uncertain publication is not.
    const current = websiteConnectorConfigSchema.safeParse(row.connectorConfig);
    if (input.credential || !current.success || JSON.stringify({ ...current.data, enabled: false }) !== JSON.stringify({ ...input.config, enabled: false })) throw new WebsiteConnectionError('Finish or reject the current connector draft before changing its destination or credentials.', 409);
  }
  if (input.config.enabled && !connectorRolloutEnabled()) throw new WebsiteConnectionError('The reusable website path is being prepared. Current jobs continue using their existing connection.', 409);
  const oldConfig = websiteConnectorConfigSchema.safeParse(row?.connectorConfig);
  const unchanged = oldConfig.success && JSON.stringify({ ...oldConfig.data, enabled: false }) === JSON.stringify({ ...input.config, enabled: false }) && !input.credential;
  const tested = Boolean(unchanged && row?.connectorTest?.ok && row.connectorTest.revision === row.revision);
  if (input.config.enabled && !tested) throw new WebsiteConnectionError('Test this saved connection successfully before enabling it.', 409);
  if (!input.credential && !row?.secretId) throw new WebsiteConnectionError('A website signing key is required.');
  let secretId = row?.secretId;
  if (input.credential) {
    const secret = await IntegrationSecret.create({ organizationId: viewer.organizationId, provider: 'website', sealed: sealSecret('integration:website', input.credential), hint: secretHint(input.credential), createdByUserId: viewer.userId });
    secretId = secret._id;
  }
  // Pause/resume changes availability, never the frozen destination revision.
  const revision = unchanged ? row!.revision ?? 0 : (row?.revision ?? 0) + 1;
  const values = { connectorConfig: input.config, secretId, revision, status: tested ? 'connected' : 'declared',
    ...(tested ? { connectorTest: { ok: true, revision, at: row!.connectorTest!.at } } : {}),
    ...(input.credential ? { credentialHint: secretHint(input.credential) } : {}) };
  if (row) {
    const changed = await IntegrationConnection.updateOne({ ...filter, _id: row._id, revision: row.revision ?? 0 }, { $set: values, ...(!tested ? { $unset: { connectorTest: '' } } : {}) });
    if (!changed.matchedCount) throw new WebsiteConnectionError('Connection changed. Reload before saving.', 409);
  } else {
    try { await IntegrationConnection.create({ ...filter, ...values, source: 'manual', connectedByUserId: viewer.userId }); }
    catch (error) { if ((error as { code?: number }).code === 11000) throw new WebsiteConnectionError('Connection was created elsewhere. Reload.', 409); throw error; }
  }
  return websiteConnectionView(viewer, companyId);
}
/** A real authenticated GET only. No validation step creates a remote draft or post. */
export async function testWebsiteConnection(viewer: CompanyViewer, companyId: string) {
  if (!isCompanyManager(viewer)) throw new WebsiteConnectionError('Only managers may test connections.', 403);
  const { filter } = await scopeFor(viewer, companyId);
  const row = await IntegrationConnection.findOne(filter).lean();
  const parsed = websiteConnectorConfigSchema.safeParse(row?.connectorConfig);
  if (!row || !parsed.success) throw new WebsiteConnectionError('Save the connection before testing.', 409);
  const credential = await credentialFor(viewer, row.secretId);
  if (!credential) throw new WebsiteConnectionError('Reconnect the website signing key.', 409);
  const until = new Date(); const since = new Date(until.getTime() - 14 * 86400000);
  try {
    const result = await websiteAdapter(parsed.data).list({ since: since.toISOString(), until: until.toISOString() }, credential);
    const saved = await IntegrationConnection.updateOne({ ...filter, _id: row._id, revision: row.revision }, { $set: { status: 'connected', connectorTest: { revision: row.revision, at: new Date(), ok: true }, lastVerifiedAt: new Date() }, $unset: { lastError: '' } });
    if (!saved.matchedCount) throw new WebsiteConnectionError('Connection changed during the test. Test its new settings again.', 409);
    return { view: await websiteConnectionView(viewer, companyId), sample: result.items[0] ?? null, warnings: result.warnings, readOnly: true as const };
  } catch (error) {
    if (error instanceof WebsiteConnectionError) throw error;
    await IntegrationConnection.updateOne({ ...filter, _id: row._id, revision: row.revision }, { $set: { connectorTest: { revision: row.revision, at: new Date(), ok: false, error: 'Could not read a valid response. Check the website connection and signing key.' } } });
    throw new WebsiteConnectionError('Could not read a valid response. Check the website connection and signing key.', 502);
  }
}
