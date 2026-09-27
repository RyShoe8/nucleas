import { NextRequest, NextResponse } from 'next/server';
import { getCompanyMetrics } from '@/lib/metrics/query';
import { isCompanyManager } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

/** Stored daily metrics for a company. Sensitive metrics (cash) only for managers who ask for them. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const days = Number(request.nextUrl.searchParams.get('days') ?? 28);
  const includeSensitive = request.nextUrl.searchParams.get('sensitive') === '1' && isCompanyManager(viewer);
  const view = await getCompanyMetrics(viewer, id, { days: Number.isFinite(days) ? days : 28, includeSensitive });
  if (!view) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json(view);
}
