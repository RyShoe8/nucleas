import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { planRequest } from '@/lib/publishing/setup';

export const dynamic = 'force-dynamic';
// Finding a site's feed reads a few pages of it.
export const maxDuration = 60;

/** { companyId, request } → what kind of job this is and, for publishing, the plan to confirm. Creates nothing. */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { companyId?: unknown; request?: unknown };
  if (typeof body.companyId !== 'string' || typeof body.request !== 'string') return NextResponse.json({ error: 'companyId and request are required.' }, { status: 400 });
  const result = await planRequest(viewer, { companyId: body.companyId, request: body.request });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ plan: result.plan }, { headers: { 'Cache-Control': 'no-store' } });
}
