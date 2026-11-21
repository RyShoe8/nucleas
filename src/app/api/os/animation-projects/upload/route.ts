import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile } from '@/lib/companies/companyProfile';
import { startAnimationUpload, finishAnimationUpload } from '@/lib/animation/animationUploads';
export const maxDuration = 120;
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
  const companyId = request.nextUrl.searchParams.get('companyId') ?? '';
  if (!(await getCompanyProfile(viewer, companyId))) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  const raw = await request.text(); if (raw.length > 4096) return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 });
  try {
    const input = JSON.parse(raw);
    const result = input.action === 'start' ? await startAnimationUpload(viewer, companyId, input) : input.action === 'complete' && typeof input.id === 'string' ? await finishAnimationUpload(viewer, companyId, input.id) : null;
    if (!result) return NextResponse.json({ error: 'Unknown upload action.' }, { status: 400 });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    // Never return provider request headers, credentials or signed URLs in an error.
    const message = error instanceof Error && !('$metadata' in error) ? error.message : 'Rogly storage could not finish this request. Retry or check the storage connection.';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
