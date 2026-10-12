import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
const company = vi.hoisted(() => ({ id: 'c'.repeat(24) }));
vi.mock('@/lib/companies/companyProfile', () => ({
  isCompanyManager: (v: { role: string }) => v.role === 'Administrator' || v.role === 'Manager',
  getCompanyProfile: async (_v: unknown, id: string) => (id === company.id ? { id, name: 'PlayBound' } : null),
}));
const deleted = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage/deleteStoredFile', () => ({ deleteStoredFile: deleted }));

import { BrandAsset } from '@/lib/models/BrandAsset';
import Client from '@/lib/models/Client';
import { brandMediaPrompt, brandMediaSources, listBrandAssets, removeBrandAsset, saveBrandAsset, sniffImageType, type StoreFile } from './brandAssets';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const user = new Types.ObjectId();
const manager = { userId: String(user), organizationId: org, employeeId: null, role: 'Manager' as const };
const plain = { ...manager, role: 'User' as const };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const png = (name = 'logo.png') => new File([PNG], name, { type: 'image/png' });
let n = 0;
const store: StoreFile = async (name) => ({ url: `https://blob.example/${name}?v=${(n += 1)}` });

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_brand_assets_test'));
  await BrandAsset.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await BrandAsset.deleteMany({});
  await Client.deleteMany({});
  deleted.mockReset();
});

describe('brand assets', () => {
  it('recognises real image bytes only', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
  });

  it('lets managers upload a logo and an icon independently, and replace one (removing the old file)', async () => {
    const first = await saveBrandAsset(manager, company.id, 'logo', png(), store);
    expect(first).toMatchObject({ ok: true, data: { kind: 'logo', fileName: 'logo.png', sizeBytes: PNG.length } });
    expect((await saveBrandAsset(manager, company.id, 'icon', png('icon.png'), store)).ok).toBe(true);
    const replaced = await saveBrandAsset(manager, company.id, 'logo', png('logo2.png'), store);
    expect(replaced).toMatchObject({ ok: true, data: { fileName: 'logo2.png' } });
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted.mock.calls[0]![0]).toBe(first.ok ? first.data.url : '');
    expect((await listBrandAssets(plain, company.id))!.map((a) => a.kind).sort()).toEqual(['icon', 'logo']);
    expect(await BrandAsset.countDocuments()).toBe(2);
  });

  it('refuses non-managers, other companies, empty or oversized files and fake images', async () => {
    expect(await saveBrandAsset(plain, company.id, 'logo', png(), store)).toMatchObject({ ok: false, status: 403 });
    expect(await saveBrandAsset(manager, 'd'.repeat(24), 'logo', png(), store)).toMatchObject({ ok: false, status: 404 });
    expect(await saveBrandAsset(manager, company.id, 'logo', new File([], 'x.png', { type: 'image/png' }), store)).toMatchObject({ ok: false, status: 400 });
    expect(await saveBrandAsset(manager, company.id, 'logo', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }), store)).toMatchObject({ ok: false, status: 413 });
    expect(await saveBrandAsset(manager, company.id, 'logo', new File(['<svg></svg>'], 'x.png', { type: 'image/png' }), store)).toMatchObject({ ok: false, status: 400 });
    expect(await BrandAsset.countDocuments()).toBe(0);
    expect(await listBrandAssets(manager, 'd'.repeat(24))).toBeNull();
  });

  it('removes an asset and its file', async () => {
    await saveBrandAsset(manager, company.id, 'icon', png(), store);
    expect(await removeBrandAsset(plain, company.id, 'icon')).toMatchObject({ ok: false, status: 403 });
    expect((await removeBrandAsset(manager, company.id, 'icon')).ok).toBe(true);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(await BrandAsset.countDocuments()).toBe(0);
  });
});

describe('media sources', () => {
  it('prefers an uploaded logo, falls back to the profile logo, and is empty when nothing exists', async () => {
    const id = new Types.ObjectId(company.id);
    expect(await brandMediaSources(org, id)).toEqual({ logoUrl: null, iconUrl: null, logoFrom: null });
    expect(brandMediaPrompt({ logoUrl: null, iconUrl: null, logoFrom: null })).toBe('');

    await Client.create({ _id: id, organizationId: org, name: 'PlayBound', logo: 'https://blob.example/profile-logo.png' } as never);
    expect(await brandMediaSources(org, id)).toEqual({ logoUrl: 'https://blob.example/profile-logo.png', iconUrl: null, logoFrom: 'profile' });

    await saveBrandAsset(manager, company.id, 'logo', png(), store);
    await saveBrandAsset(manager, company.id, 'icon', png('i.png'), store);
    const sources = await brandMediaSources(org, id);
    expect(sources.logoFrom).toBe('assets');
    expect(sources.logoUrl).toContain('-logo-');
    expect(sources.iconUrl).toContain('-icon-');
    const prompt = brandMediaPrompt(sources);
    expect(prompt).toContain(sources.logoUrl!);
    expect(prompt).toContain(sources.iconUrl!);
    expect(prompt).toMatch(/never redraw/);
  });

  it('turns local upload paths into absolute links when an origin is known', () => {
    expect(brandMediaPrompt({ logoUrl: '/uploads/brand-assets/a.png', iconUrl: null, logoFrom: 'assets' }, 'https://os.nucleas.app')).toContain('https://os.nucleas.app/uploads/brand-assets/a.png');
  });
});
