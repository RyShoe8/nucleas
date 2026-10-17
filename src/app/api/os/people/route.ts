import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { listOrgPeople } from '@/lib/publishing/notify';

export const dynamic = 'force-dynamic';

/** People in the viewer's organization (name only), for choosing who a job notifies. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const people = (await listOrgPeople(viewer.organizationId)).map((p) => ({ userId: p.userId, name: p.name }));
  return NextResponse.json({ people }, { headers: { 'Cache-Control': 'no-store' } });
}
