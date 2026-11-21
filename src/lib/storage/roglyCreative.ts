import 'server-only';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { listCompanyProfiles } from '@/lib/companies/companyProfile';
import { IntegrationConnection } from '@/lib/models/Integration';
import { readConnectionCredential } from '@/lib/integrations/connections';
import { secretFor, siteRequest } from '@/lib/roundups/sources';

export const CREATIVE_ENDPOINT = 'https://s3.rogly.net';
export const CREATIVE_BUCKET = 'playbound';
export const CREATIVE_PREFIX = 'nucleas/creative/';
export const CREATIVE_MAX_BYTES = 64 * 1024 * 1024;
const bridge = 'https://playbound.club/api/integrations/nucleas/creative-storage';
type StorageResult = { url?: string; configured?: boolean; completed?: boolean };
export interface CreativeStorageClient {
  organizationId: string;
  request: (action: string, input?: Record<string, unknown>) => Promise<StorageResult>;
  destroy: () => void;
}
/** Reuses the existing PlayBound connection. S3 credentials stay on PlayBound's server. */
export async function openCreativeStorage(organizationId: Types.ObjectId): Promise<CreativeStorageClient | null> {
  const row = await IntegrationConnection.findOne({ organizationId, provider: 'website', scope: 'company', 'connectorConfig.origin': { $in: ['https://playbound.club', 'https://www.playbound.club'] } }).select('status secretId connectorConfig connectorTest revision').lean();
  let credential: string | null | undefined;
  if (row) {
    if (row.status !== 'connected' || !row.connectorConfig?.enabled || !row.connectorTest?.ok || row.connectorTest.revision !== row.revision) return null;
    credential = await readConnectionCredential(organizationId, row._id);
  } else {
    // Legacy roundup access belongs only to the organization which owns PlayBound.
    const companies = await listCompanyProfiles({ organizationId, userId: String(organizationId), employeeId: null, role: 'Administrator' });
    const playbound = companies.find(c => c.relationship === 'owned' && ['playbound.club', 'www.playbound.club'].includes(c.domain ?? ''));
    if (playbound) credential = secretFor(playbound.id, 'https://playbound.club/api/integrations/nucleas/roundup');
  }
  if (!credential) return null;
  const secret = credential;
  return { organizationId: String(organizationId), destroy() {}, request: async (action, input = {}) => {
    const result = await siteRequest(bridge, secret, 'POST', { ...input, action, organizationId: String(organizationId) });
    if (!result || typeof result !== 'object') throw Error('Invalid creative storage response.');
    return result as StorageResult;
  } };
}
export function creativeKeys(org: string, company: string, asset: string) {
  if (![org, company, asset].every(id => /^[a-f0-9]{24}$/i.test(id))) throw Error('Invalid creative storage scope.');
  return { staging: `${CREATIVE_PREFIX}staging/${org}/${company}/${asset}.rigby`, source: `${CREATIVE_PREFIX}organizations/${org}/companies/${company}/animations/${asset}/project.rigby` };
}
function keyScope(client: CreativeStorageClient, key: string) {
  const stage = /^nucleas\/creative\/staging\/([a-f0-9]{24})\/([a-f0-9]{24})\/([a-f0-9]{24})\.rigby$/i.exec(key);
  const source = /^nucleas\/creative\/organizations\/([a-f0-9]{24})\/companies\/([a-f0-9]{24})\/animations\/([a-f0-9]{24})\/project\.rigby$/i.exec(key);
  const match = stage ?? source;
  if (!match || match[1] !== client.organizationId) throw Error('Object is outside this organization’s creative storage.');
  return { companyId: match[2], assetId: match[3], staging: Boolean(stage) };
}
export function creativeUrl(value: unknown, key: string) {
  if (typeof value !== 'string') throw Error('Storage did not return a signed URL.');
  const url = new URL(value);
  if (url.origin !== CREATIVE_ENDPOINT || url.pathname !== `/${CREATIVE_BUCKET}/${key}` || url.username || url.password) throw Error('Unexpected animation storage destination.');
  return value;
}
export async function signedCreativeUpload(client: CreativeStorageClient, key: string, size: number) {
  const scope = keyScope(client, key);
  if (!scope.staging || !Number.isInteger(size) || size < 22 || size > CREATIVE_MAX_BYTES) throw Error('Invalid animation upload size.');
  return creativeUrl((await client.request('upload', { ...scope, size })).url, key);
}
export async function signedCreativeDownload(client: CreativeStorageClient, key: string) {
  return creativeUrl((await client.request('download', keyScope(client, key))).url, key);
}
export async function readCreativeObject(client: CreativeStorageClient, key: string, expectedSize?: number) {
  const url = await signedCreativeDownload(client,key);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(90000), cache: 'no-store' });
  if (!response.ok || !response.body) throw Error('Could not read the private animation source.');
  const reader = response.body.getReader(), limit = expectedSize ?? CREATIVE_MAX_BYTES;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    if (Number(response.headers.get('content-length') ?? 0) > limit) throw Error('Stored animation exceeds its declared size.');
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw Error('Stored animation exceeds its declared size.'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (expectedSize !== undefined && size !== expectedSize) throw Error('Animation upload is incomplete.');
  const bytes = Buffer.concat(chunks);
  return { bytes, etag: response.headers.get('etag'), sha256: createHash('sha256').update(bytes).digest('hex') };
}
export async function promoteCreativeSource(client: CreativeStorageClient, staging: string, source: string, etag: string) {
  const from = keyScope(client, staging), to = keyScope(client, source);
  if (!from.staging || to.staging || from.companyId !== to.companyId || from.assetId !== to.assetId) throw Error('Invalid animation promotion.');
  await client.request('promote', { ...to, etag });
}
export async function putCreativeSource(client: CreativeStorageClient, key: string, bytes: Buffer) {
  const scope = keyScope(client,key);
  if (scope.staging || bytes.length > CREATIVE_MAX_BYTES) throw Error('Invalid animation source.');
  const staging = creativeKeys(client.organizationId,scope.companyId,scope.assetId).staging;
  const url = await signedCreativeUpload(client,staging,bytes.length);
  const response = await fetch(url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(bytes),redirect:'error',signal:AbortSignal.timeout(90000)});
  if (!response.ok) throw Error('Could not store animation source.');
  const verified = await readCreativeObject(client,staging,bytes.length);
  if (!verified.etag || verified.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('Animation integrity check failed.');
  await promoteCreativeSource(client,staging,key,verified.etag);
  await removeCreativeStaging(client,staging).catch(()=>{});
}
export async function removeCreativeStaging(client: CreativeStorageClient, key: string) {
  const scope = keyScope(client,key); if (!scope.staging) throw Error('Only unfinished uploads can be removed.');
  await client.request('remove-staging',scope);
}
