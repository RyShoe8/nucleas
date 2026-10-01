import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getSeoBrief, updateSeoBrief } from '@/lib/jobs/seoBriefs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
  const companyId = request.nextUrl.searchParams.get('companyId');
  if (!companyId) return NextResponse.json({ error: 'companyId is required.' }, { status: 400 });
  return NextResponse.json({ brief: await getSeoBrief(viewer, companyId, (await params).projectId) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.companyId !== 'string') return NextResponse.json({ error: 'companyId is required.' }, { status: 400 });
  const result = await updateSeoBrief(viewer, body.companyId, (await params).projectId, body);
  return result.ok ? NextResponse.json({ brief: result.brief }) : NextResponse.json({ error: result.error }, { status: result.status });
}
