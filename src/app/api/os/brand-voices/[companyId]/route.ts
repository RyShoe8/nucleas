import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getBrandVoice, updateBrandVoice } from '@/lib/brandVoice/service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  return NextResponse.json({ voice: await getBrandVoice(viewer, (await params).companyId) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const result = await updateBrandVoice(viewer, (await params).companyId, await request.json().catch(() => null));
  return result.ok ? NextResponse.json({ voice: result.voice }) : NextResponse.json({ error: result.error }, { status: result.status });
}
