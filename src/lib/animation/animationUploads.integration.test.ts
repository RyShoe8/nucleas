import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const mocks = vi.hoisted(() => ({ read: vi.fn(), promote: vi.fn(), remove: vi.fn(), signed: vi.fn() }));
vi.mock('@/lib/storage/roglyCreative', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/storage/roglyCreative')>();
  return { ...original, openCreativeStorage: async () => ({ destroy() {} }), readCreativeObject: mocks.read, promoteCreativeSource: mocks.promote, removeCreativeStaging: mocks.remove, signedCreativeUpload: mocks.signed };
});
import { startAnimationUpload, finishAnimationUpload } from './animationUploads';
import { AnimationUpload } from '@/lib/models/CreativeStorage';
import { AnimationPayload } from '@/lib/models/AnimationPayload';
import Asset from '@/lib/models/Asset';
let db: MongoMemoryServer;
const viewer = { userId: 'a'.repeat(24), organizationId: new Types.ObjectId(), employeeId: null, role: 'Administrator' as const };
const company = 'b'.repeat(24);
const bytes = readFileSync('vendor/scene-kit/library/tools/art/story/projects/tiffany.rigby');
const sha256 = createHash('sha256').update(bytes).digest('hex');
beforeAll(async () => { db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => { await Promise.all([AnimationUpload.deleteMany({}), AnimationPayload.deleteMany({}), Asset.deleteMany({})]); vi.clearAllMocks(); mocks.signed.mockResolvedValue('https://s3.rogly.net/nucleas-creative/staging/test'); mocks.read.mockResolvedValue({ bytes, sha256, etag: 'source-etag' }); mocks.promote.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); });
describe('verified company animation versions', () => {
  it('keeps a source larger than 3 MB on Rogly, metadata in Mongo, and completes idempotently', async () => {
    const upload = await startAnimationUpload(viewer, company, { size: bytes.length, sha256 });
    const result = await finishAnimationUpload(viewer, company, upload.id);
    expect(result.id).toBe(upload.id);
    const payload = await AnimationPayload.findOne({ assetId: upload.id }).lean();
    expect(payload?.storage).toBe('rogly'); expect(payload?.bytes).toBeUndefined(); expect(payload?.sha256).toBe(sha256);
    expect(mocks.promote).toHaveBeenCalledOnce();
    await finishAnimationUpload(viewer, company, upload.id);
    expect(mocks.promote).toHaveBeenCalledOnce(); expect(await Asset.countDocuments({})).toBe(1);
  });
  it('rejects other companies, organizations and users before reading any object', async () => {
    const upload = await startAnimationUpload(viewer, company, { size: bytes.length, sha256 });
    await expect(finishAnimationUpload(viewer, 'd'.repeat(24), upload.id)).rejects.toThrow();
    await expect(finishAnimationUpload({ ...viewer, organizationId: new Types.ObjectId() }, company, upload.id)).rejects.toThrow();
    await expect(finishAnimationUpload({ ...viewer, userId: 'e'.repeat(24) }, company, upload.id)).rejects.toThrow();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('does not publish metadata for changed bytes or malformed projects, and allows retry', async () => {
    const upload = await startAnimationUpload(viewer, company, { size: bytes.length, sha256 });
    mocks.read.mockResolvedValueOnce({ bytes, sha256: '0'.repeat(64), etag: 'bad' });
    await expect(finishAnimationUpload(viewer, company, upload.id)).rejects.toThrow(/do not match/);
    expect(mocks.promote).not.toHaveBeenCalled(); expect(await Asset.countDocuments({})).toBe(0);
    await finishAnimationUpload(viewer, company, upload.id);
    expect(await Asset.countDocuments({})).toBe(1);
  });
  it('keeps failed promotions retryable without marking a source as saved', async () => {
    const upload = await startAnimationUpload(viewer, company, { size: bytes.length, sha256 });
    mocks.promote.mockRejectedValueOnce(Error('Precondition failed'));
    await expect(finishAnimationUpload(viewer, company, upload.id)).rejects.toThrow();
    expect(await Asset.countDocuments({})).toBe(0);
    expect((await AnimationUpload.findOne({ assetId: upload.id }))?.state).toBe('pending');
  });
});
