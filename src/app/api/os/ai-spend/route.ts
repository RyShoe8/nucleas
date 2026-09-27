import { NextRequest, NextResponse } from 'next/server';
import User from '@/lib/models/User';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getOrgAiSpend, isValidPeriod } from '@/lib/ai/spendReport';

export const dynamic = 'force-dynamic';

/** Organization-wide AI spend for a month. Organization administrators only. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const user = await User.findById(viewer.userId).select('isAdmin').lean<{ isAdmin?: boolean }>();
  if (viewer.role !== 'Administrator' && !user?.isAdmin) {
    return NextResponse.json({ error: 'Only administrators can see organization AI spend.' }, { status: 403 });
  }
  const period = request.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
  if (!isValidPeriod(period)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  return NextResponse.json(await getOrgAiSpend(String(viewer.organizationId), period), { headers: { 'Cache-Control': 'no-store' } });
}
