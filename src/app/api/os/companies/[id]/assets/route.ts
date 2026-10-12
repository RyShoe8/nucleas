import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { isCompanyManager } from '@/lib/companies/companyProfile';
import { isBrandAssetKind, listBrandAssets, removeBrandAsset, saveBrandAsset } from '@/lib/brandAssets/brandAssets';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** The company's brand files (logo, icon), if any. */
export async function GET(request: NextRequest, { params }: Params) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const assets = await listBrandAssets(viewer, (await params).id);
  return assets ? NextResponse.json({ assets, canManage: isCompanyManager(viewer) }, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'Company not found.' }, { status: 404 });
}

/** Uploads (or replaces) the logo or the icon. */
export async function POST(request: NextRequest, { params }: Params) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const form = await request.formData().catch(() => null);
  const kind = form?.get('kind');
  const file = form?.get('file');
  if (!isBrandAssetKind(kind) || !(file instanceof File)) return NextResponse.json({ error: 'Choose logo or icon and a file.' }, { status: 400 });
  const result = await saveBrandAsset(viewer, (await params).id, kind, file);
  return result.ok ? NextResponse.json({ asset: result.data }, { status: 201 }) : NextResponse.json({ error: result.error }, { status: result.status });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const kind = request.nextUrl.searchParams.get('kind');
  if (!isBrandAssetKind(kind)) return NextResponse.json({ error: 'Choose logo or icon.' }, { status: 400 });
  const result = await removeBrandAsset(viewer, (await params).id, kind);
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
}
