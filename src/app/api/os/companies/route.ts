import { NextRequest, NextResponse } from 'next/server';
import { IntegrationConnection } from '@/lib/models/Integration';
import { listCompanyProfiles } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

/** Companies visible to the viewer, with a connection status summary. */
export async function GET(request: NextRequest) {
  try {
    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;

    const companies = await listCompanyProfiles(viewer);
    const counts = await IntegrationConnection.aggregate<{ _id: { companyId: unknown; status: string }; n: number }>([
      { $match: { organizationId: viewer.organizationId, companyId: { $ne: null } } },
      { $group: { _id: { companyId: '$companyId', status: '$status' }, n: { $sum: 1 } } },
    ]);
    const summary = new Map<string, Record<string, number>>();
    for (const row of counts) {
      const key = String(row._id.companyId);
      summary.set(key, { ...(summary.get(key) ?? {}), [row._id.status]: row.n });
    }

    return NextResponse.json({
      companies: companies.map((c) => ({ ...c, connections: summary.get(c.id) ?? {} })),
    });
  } catch (error) {
    console.error('[os/companies] list failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
