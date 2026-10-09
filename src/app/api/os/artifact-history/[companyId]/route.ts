import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { artifactHistory } from '@/lib/jobs/artifactHistory';

export async function GET(request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const kind = request.nextUrl.searchParams.get('kind');
  if (kind !== 'brand_voice' && kind !== 'marketing_plan') return NextResponse.json({ error: 'Unknown artifact.' }, { status: 400 });
  const history = await artifactHistory(viewer, (await params).companyId, kind);
  return history ? NextResponse.json(history, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'Company not found.' }, { status: 404 });
}
