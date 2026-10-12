import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getItemDetail } from '@/lib/watches/watches';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const result = await getItemDetail(viewer, id);
  return result.ok ? NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: result.error }, { status: result.status });
}
