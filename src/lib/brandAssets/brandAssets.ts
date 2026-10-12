import 'server-only';
import { Types } from 'mongoose';
import { BrandAsset, BRAND_ASSET_KINDS, type BrandAssetKind } from '@/lib/models/BrandAsset';
import Client from '@/lib/models/Client';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { deleteStoredFile } from '@/lib/storage/deleteStoredFile';

export const BRAND_ASSET_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export interface BrandAssetView {
  kind: BrandAssetKind;
  url: string;
  fileName: string | null;
  sizeBytes: number;
  updatedAt: string;
}

export const isBrandAssetKind = (value: unknown): value is BrandAssetKind => typeof value === 'string' && (BRAND_ASSET_KINDS as readonly string[]).includes(value);

/** Magic bytes, so a renamed file cannot pass as an image. */
export function sniffImageType(bytes: Uint8Array): (typeof ALLOWED_TYPES)[number] | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

type Row = { kind: BrandAssetKind; url: string; fileName?: string; sizeBytes: number; updatedAt?: Date };
const view = (r: Row): BrandAssetView => ({ kind: r.kind, url: r.url, fileName: r.fileName ?? null, sizeBytes: r.sizeBytes, updatedAt: r.updatedAt?.toISOString() ?? '' });

export async function listBrandAssets(viewer: CompanyViewer, companyId: string): Promise<BrandAssetView[] | null> {
  if (!(await getCompanyProfile(viewer, companyId))) return null;
  const rows = await BrandAsset.find({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId) }).lean<Row[]>();
  return rows.map(view);
}

export interface StoredFile { url: string }
export type StoreFile = (name: string, file: File) => Promise<StoredFile>;

/** Vercel Blob in production, public/uploads when no blob token is configured (local development). */
export const storePublicFile: StoreFile = async (name, file) => {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`brand-assets/${name}`, file, { access: 'public', contentType: file.type });
    return { url: blob.url };
  }
  const { mkdir, writeFile } = await import('fs/promises');
  const { join } = await import('path');
  const dir = join(process.cwd(), 'public', 'uploads', 'brand-assets');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));
  return { url: `/uploads/brand-assets/${name}` };
};

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function saveBrandAsset(viewer: CompanyViewer, companyId: string, kind: BrandAssetKind, file: File, store: StoreFile = storePublicFile): Promise<Result<BrandAssetView>> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can change brand assets.' };
  if (!(await getCompanyProfile(viewer, companyId))) return { ok: false, status: 404, error: 'Company not found.' };
  if (file.size === 0) return { ok: false, status: 400, error: 'That file is empty.' };
  if (file.size > BRAND_ASSET_MAX_BYTES) return { ok: false, status: 413, error: 'Files can be up to 10 MB.' };
  const type = sniffImageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type) return { ok: false, status: 400, error: 'Use a PNG, JPG or WebP image.' };

  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const stored = await store(`${companyId}-${kind}-${Date.now()}.${ext}`, new File([await file.arrayBuffer()], file.name, { type }));
  const previous = await BrandAsset.findOneAndUpdate(
    { organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId), kind },
    { $set: { url: stored.url, fileName: file.name.slice(0, 200), contentType: type, sizeBytes: file.size, uploadedByUserId: new Types.ObjectId(viewer.userId) } },
    { upsert: true, new: false }
  ).lean<{ url?: string }>();
  if (previous?.url && previous.url !== stored.url) await deleteStoredFile(previous.url);
  const row = await BrandAsset.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId), kind }).lean<Row>();
  return { ok: true, data: view(row!) };
}

export async function removeBrandAsset(viewer: CompanyViewer, companyId: string, kind: BrandAssetKind): Promise<Result<null>> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can change brand assets.' };
  if (!(await getCompanyProfile(viewer, companyId))) return { ok: false, status: 404, error: 'Company not found.' };
  const row = await BrandAsset.findOneAndDelete({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId), kind }).lean<{ url?: string }>();
  if (row?.url) await deleteStoredFile(row.url);
  return { ok: true, data: null };
}

export interface BrandMediaSources {
  logoUrl: string | null;
  iconUrl: string | null;
  /** Where the logo came from: an uploaded Assets file, or the company's existing profile logo. */
  logoFrom: 'assets' | 'profile' | null;
}

/**
 * The files every generated image or video for a company starts from. An uploaded Assets file wins; without
 * one, the company's profile logo is used as the logo. Everything is optional.
 */
export async function brandMediaSources(organizationId: Types.ObjectId, companyId: Types.ObjectId | string): Promise<BrandMediaSources> {
  const id = new Types.ObjectId(String(companyId));
  const [rows, client] = await Promise.all([
    BrandAsset.find({ organizationId, companyId: id }).select('kind url').lean<{ kind: BrandAssetKind; url: string }[]>(),
    Client.findOne({ _id: id, organizationId }).select('logo').lean<{ logo?: string }>(),
  ]);
  const logo = rows.find((r) => r.kind === 'logo')?.url ?? null;
  const icon = rows.find((r) => r.kind === 'icon')?.url ?? null;
  const profileLogo = client?.logo?.startsWith('http') || client?.logo?.startsWith('/') ? client.logo : null;
  return { logoUrl: logo ?? profileLogo, iconUrl: icon, logoFrom: logo ? 'assets' : profileLogo ? 'profile' : null };
}

/** Prompt text telling a model to build any image or video from the company's own files. Empty when there are none. */
export function brandMediaPrompt(sources: BrandMediaSources, origin?: string): string {
  const abs = (url: string) => (url.startsWith('/') && origin ? `${origin}${url}` : url);
  const lines = [sources.logoUrl ? `- Logo (high quality): ${abs(sources.logoUrl)}` : '', sources.iconUrl ? `- Icon: ${abs(sources.iconUrl)}` : ''].filter(Boolean);
  if (!lines.length) return '';
  return `# Brand assets (the company's own files)\n${lines.join('\n')}\nWhenever you write a brief, prompt or storyboard for an image or video, build it from these files: show the real logo and icon exactly as they are, keep their colors and proportions, and never redraw, restyle or invent a different mark.`;
}
