import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AnimationUpload } from '@/lib/models/CreativeStorage';
import Asset from '@/lib/models/Asset';
import { AnimationPayload } from '@/lib/models/AnimationPayload';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { creativeKeys, CREATIVE_MAX_BYTES, openCreativeStorage, signedCreativeUpload, readCreativeObject, promoteCreativeSource, removeCreativeStaging, type CreativeStorageClient } from '@/lib/storage/roglyCreative';
import { inspectRigby, RIGBY_TAG } from './rigbyProject';

/** Routes resolve company access first; every upload lookup also binds user, company and tenant. */
export async function startAnimationUpload(viewer: CompanyViewer, companyId: string, input: { size: number; sha256: string }) {
  if (!Number.isInteger(input.size) || input.size < 22 || input.size > CREATIVE_MAX_BYTES || !/^[a-f0-9]{64}$/.test(input.sha256)) throw Error('Choose a valid animation source up to 64 MB.');
  const client = await openCreativeStorage(viewer.organizationId);
  if (!client) throw Error('The existing PlayBound game-storage connection is unavailable. Check its connection and storage bridge.');
  try {
    const scope = { organizationId: viewer.organizationId, companyId, userId: viewer.userId };
    if (await AnimationUpload.countDocuments({ ...scope, state: { $ne: 'complete' }, expiresAt: { $gt: new Date() } }) >= 10) throw Error('Finish existing uploads or retry in an hour.');
    const assetId = new Types.ObjectId(), keys = creativeKeys(String(viewer.organizationId), companyId, String(assetId));
    const url = await signedCreativeUpload(client, keys.staging, input.size);
    await AnimationUpload.create({ ...scope, assetId, size: input.size, sha256: input.sha256, expiresAt: new Date(Date.now() + 3600000) });
    return { id: String(assetId), url };
  } finally { client.destroy(); }
}

export async function finishAnimationUpload(viewer: CompanyViewer, companyId: string, assetId: string) {
  if (!Types.ObjectId.isValid(assetId)) throw Error('Upload not found.');
  const scope = { organizationId: viewer.organizationId, companyId, userId: viewer.userId, assetId };
  if (await AnimationUpload.exists({ ...scope, state: 'complete' })) return { id: assetId };
  const lease = randomUUID();
  const row = await AnimationUpload.findOneAndUpdate({ ...scope, expiresAt: { $gt: new Date() }, $or: [{ state: 'pending' }, { state: 'verifying', updatedAt: { $lt: new Date(Date.now() - 300000) } }] }, { $set: { state: 'verifying', lease } }, { new: true }).lean();
  if (!row) throw Error('This upload is expired, unavailable or already being verified.');
  let client: CreativeStorageClient | null = null;
  try {
    client = await openCreativeStorage(viewer.organizationId);
    if (!client) throw Error('Rogly storage is not connected.');
    const keys = creativeKeys(String(viewer.organizationId), companyId, assetId);
    const result = await readCreativeObject(client, keys.staging, row.size);
    if (result.sha256 !== row.sha256 || !result.etag) throw Error('Uploaded bytes do not match the selected project. Upload it again.');
    const info = inspectRigby(result.bytes, CREATIVE_MAX_BYTES);
    await promoteCreativeSource(client, keys.staging, keys.source, result.etag);
    await AnimationPayload.updateOne({ assetId, organizationId: viewer.organizationId, companyId }, { $setOnInsert: { storage: 'rogly', objectKey: keys.source, byteLength: row.size, sha256: row.sha256 } }, { upsert: true });
    await Asset.updateOne({ _id: assetId, linkedClientId: companyId }, { $setOnInsert: {
      name: info.name, type: 'file', category: 'Animation', tags: [RIGBY_TAG], linkedClientId: companyId, userId: viewer.userId,
      description: `Editable Rigby source Â· ${info.bones} bones Â· ${info.animations.length} animations Â· stored privately on Rogly`,
      fileUrl: `/api/os/animation-projects?companyId=${companyId}&id=${assetId}`,
    } }, { upsert: true });
    await AnimationUpload.updateOne({ ...scope, lease }, { $set: { state: 'complete' }, $unset: { expiresAt: 1, lease: 1 } });
    await removeCreativeStaging(client, keys.staging).catch(() => {}); // Bucket lifecycle also removes expired staging objects.
    return { id: assetId, ...info };
  } catch (error) {
    await AnimationUpload.updateOne({ ...scope, lease }, { $set: { state: 'pending' }, $unset: { lease: 1 } });
    throw error;
  } finally { client?.destroy(); }
}
