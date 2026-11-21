import { NextRequest, NextResponse } from 'next/server';
import { getCompanyMetrics } from '@/lib/metrics/query';
import { isCompanyManager } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { reportWindow } from '@/lib/metrics/reportWindow';

/** Stored daily metrics for a company. Sensitive metrics (cash) only for managers who ask for them. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const days = Number(request.nextUrl.searchParams.get('days') ?? 28);
  const period = Number(request.nextUrl.searchParams.get('period') ?? 7);
  if (![7, 14, 28, 90].includes(period)) return NextResponse.json({ error: 'Choose 7, 14, 28 or 90 days.' }, { status: 400 });
  const includeSensitive = request.nextUrl.searchParams.get('sensitive') === '1' && isCompanyManager(viewer);
  const site = request.nextUrl.searchParams.get('site');
  let range;
  try { range = reportWindow(request.nextUrl.searchParams.get('start'), request.nextUrl.searchParams.get('end')); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  const view = await getCompanyMetrics(viewer, id, { days: Number.isFinite(days) ? days : 28, includeSensitive, periodDays: period, site, ...range });
  if (!view) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
}
