import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { readServiceData, refreshServiceData } from '@/lib/companies/serviceData';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function handle(request: NextRequest, context: Context, refresh: boolean) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await context.params;
  if (!await getCompanyProfile(viewer, id)) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  if (refresh && !isCompanyManager(viewer)) return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  try {
    const report = await (refresh ? refreshServiceData : readServiceData)(viewer.organizationId, id);
    return NextResponse.json({ report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Service data unavailable. Check the admin session and that the site supports /api/admin/nucleas/service-metrics. Previous data is retained.' }, { status: 502 });
  }
}
export const GET = (request: NextRequest, context: Context) => handle(request, context, false);
export const POST = (request: NextRequest, context: Context) => handle(request, context, true);
