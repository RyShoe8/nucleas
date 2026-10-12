import { NextRequest, NextResponse } from 'next/server';
import { IntegrationConnection } from '@/lib/models/Integration';
import { listCompanyProfiles } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { createCompany } from '@/lib/companies/createCompany';
import { applyDeclaredConnections } from '@/lib/integrations/declareConnections';

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

/** Adds a company (one we run) or a client. Managers and administrators only. */
export async function POST(request: NextRequest) {
  try {
    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;
    const result = await createCompany(viewer, await request.json().catch(() => null));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    // Give the new company its expected integrations (shown as "not connected" until set up). Never blocks the add.
    await applyDeclaredConnections(viewer.organizationId).catch((error) => console.error('[os/companies] declare failed', error instanceof Error ? error.message : 'unknown'));
    return NextResponse.json({ id: result.id, name: result.name }, { status: 201 });
  } catch (error) {
    console.error('[os/companies] create failed', error);
    return NextResponse.json({ error: 'Could not add the company.' }, { status: 500 });
  }
}
