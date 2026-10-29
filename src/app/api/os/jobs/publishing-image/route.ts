import { NextRequest, NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import sharp from 'sharp';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { PublishingImage } from '@/lib/models/PublishingImage';

export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Manager access required.' }, { status: 403 });
  if (Number(request.headers.get('content-length')) > 4_000_000) return NextResponse.json({ error: 'Use an image smaller than 3 MB.' }, { status: 413 });
  const form = await request.formData();
  const companyId = String(form.get('companyId') ?? '');
  if (!/^[a-f0-9]{24}$/i.test(companyId) || !await getCompanyProfile(viewer, companyId)) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  const file = form.get('file');
  const alt = String(form.get('alt') ?? '').trim().slice(0, 1000);
  if (!(file instanceof File) || file.size > 3_000_000 || !alt || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return NextResponse.json({ error: 'Choose a PNG, JPEG or WebP under 3 MB and enter image description text.' }, { status: 400 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'Image storage is not configured (BLOB_READ_WRITE_TOKEN).' }, { status: 503 });
  let bytes: Buffer;
  try {
    bytes = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 25_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    if (bytes.length > 900_000) return NextResponse.json({ error: 'The optimized image is too large. Try a simpler or smaller image.' }, { status: 400 });
  } catch { return NextResponse.json({ error: 'That image could not be decoded.' }, { status: 400 }); }
  const blob = await put(`publishing/${viewer.organizationId}/${companyId}/${crypto.randomUUID()}.jpg`, bytes, { access: 'public', contentType: 'image/jpeg' });
  try {
    const image = await PublishingImage.create({ organizationId: viewer.organizationId, companyId, url: blob.url, alt });
    return NextResponse.json({ image: { id: String(image._id), url: blob.url, alt } });
  } catch (error) { await del(blob.url).catch(() => undefined); throw error; }
}
