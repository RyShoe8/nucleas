import 'server-only';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { getWebsiteConnection, getPinnedWebsiteConnection } from '@/lib/connectors/connections';
import { ListResultSchema, PublicationReceiptSchema, type PublishInput } from '@/lib/connectors/contracts';
import { websiteCapabilities } from '@/lib/connectors/capabilities';
import { CAPABILITIES } from '@/lib/capabilities/registry';
import { invokeCapability } from '@/lib/capabilities/runtime';

export type TransportBinding = { kind: 'legacy' | 'connector'; connectionId?: string | null; revision?: number | null; origin?: string | null };
export const connectorRoundupsEnabled = () => process.env.NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED === 'true';
// Namespace site coverage to prevent arbitrary site IDs colliding with repository release IDs.
export const connectorCoverageId = (id: string) => `website:${encodeURIComponent(id)}`;
export const connectorPublishIds = (ids: readonly string[]) => ids.filter(id => id.startsWith('website:')).map(id => decodeURIComponent(id.slice(8)));

export async function selectRoundupTransport(viewer: CompanyViewer, companyId: string): Promise<TransportBinding> {
  if (!connectorRoundupsEnabled()) return { kind: 'legacy' };
  const connection = await getWebsiteConnection(viewer, companyId);
  if (!connection) return { kind: 'legacy' };
  return { kind: 'connector', connectionId: connection.connectionId, revision: connection.revision, origin: connection.config.origin };
}

export async function assertRoundupConnection(viewer: CompanyViewer, companyId: string, binding: TransportBinding) {
  if (!connectorRoundupsEnabled()) throw new Error('Connector roundups are disabled. This draft cannot change transport.');
  if (binding.kind !== 'connector' || !binding.connectionId || binding.revision == null || !binding.origin) throw new Error('Missing frozen connector binding.');
  return getPinnedWebsiteConnection(viewer, companyId, { connectionId: binding.connectionId, revision: binding.revision, origin: binding.origin });
}

async function invoke(viewer: CompanyViewer, companyId: string, binding: TransportBinding, capabilityId: string, input: unknown, publish = false) {
  const connection = await assertRoundupConnection(viewer, companyId, binding);
  const definitions = websiteCapabilities(connection.config, () => assertRoundupConnection(viewer, companyId, binding));
  const def = definitions.find(def => def.id === capabilityId)!;
  // Only the service's manager-approved, leased snapshot may use this publication path.
  const registry = [...CAPABILITIES.filter(item => !definitions.some(def => def.id === item.id)), ...definitions.map(item => publish && item === def ? { ...item, approval: 'auto' as const } : item)];
  const result = await invokeCapability(viewer, companyId, capabilityId, input, { registry, connectionId: connection.connectionId,
    ...(publish ? { idempotencyKey: (input as PublishInput).idempotencyKey } : {}) });
  if (!result.ok) throw new Error(result.error);
  if (!['succeeded', 'verified'].includes(result.invocation.status) || (publish && result.invocation.verified !== true)) throw new Error(result.invocation.error || `Connector ${result.invocation.status}; publication is not confirmed.`);
  return result.invocation.output;
}

export async function listConnectorItems(viewer: CompanyViewer, companyId: string, binding: TransportBinding, since: Date, until: Date) {
  const items: ReturnType<typeof ListResultSchema.parse>['items'] = [];
  const warnings = new Set<string>();
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let baseline: ReturnType<typeof ListResultSchema.parse>['baseline'];
  let cursor: string | undefined;
  const baselineKey = (value: NonNullable<typeof baseline>) => JSON.stringify({ publishedAt: value.publishedAt ? new Date(value.publishedAt).toISOString() : null,
    coverageEnd: value.coverageEnd ? new Date(value.coverageEnd).toISOString() : null, coveredIds: [...value.coveredIds].sort(), slug: value.slug, url: value.url });
  for (let page = 0; page < 5; page++) {
    const result = ListResultSchema.parse(await invoke(viewer, companyId, binding, 'content.items.list', { since: since.toISOString(), until: until.toISOString(), ...(cursor ? { cursor } : {}) }));
    if (result.baseline) {
      if (baseline && baselineKey(baseline) !== baselineKey(result.baseline)) throw new Error('Connector baseline changed during pagination. Coverage unchanged.');
      baseline = result.baseline;
    }
    for (const item of result.items) {
      if (ids.has(item.id)) throw new Error('Connector returned duplicate item IDs. Coverage unchanged.');
      ids.add(item.id); items.push(item);
    }
    if (items.length > 2000) throw new Error('Connector source limit exceeded. Coverage unchanged.');
    result.warnings.forEach(warning => warnings.add(warning));
    if (!result.nextCursor) return { version: 1 as const, items, baseline, warnings: [...warnings] };
    if (cursors.has(result.nextCursor)) throw new Error('Connector cursor cycle. Coverage unchanged.');
    cursors.add(result.nextCursor); cursor = result.nextCursor;
  }
  throw new Error('Connector page limit exceeded. Coverage unchanged.');
}

export async function publishConnectorSnapshot(viewer: CompanyViewer, companyId: string, binding: TransportBinding, input: PublishInput) {
  const receipt = PublicationReceiptSchema.parse(await invoke(viewer, companyId, binding, 'content.posts.publish', input, true));
  if (receipt.idempotencyKey !== input.idempotencyKey || new URL(receipt.url).origin !== binding.origin) throw new Error('Connector receipt does not match the frozen publication.');
  return receipt;
}
