import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyFacts, saveCompanyFacts } from '@/lib/companies/companyFacts';
import { recordActivity } from '@/lib/companies/activityLog';

export const dynamic = 'force-dynamic';

/** What the company is: drafted by its Company Overview, corrected by a person. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const view = await getCompanyFacts(viewer, (await params).id);
  if (!view) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
}

const LABEL: Record<string, string> = { description: 'what it does', audience: 'who it is for', keywords: 'topics', competitors: 'competitors', keyFacts: 'key facts' };

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const result = await saveCompanyFacts(viewer, id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const changed = body && typeof body === 'object' ? Object.keys(body).map((key) => LABEL[key]).filter(Boolean) : [];
  await recordActivity({ organizationId: viewer.organizationId, companyId: id, kind: 'company', title: 'Company information updated', detail: changed.join(', ') || undefined, actorUserId: viewer.userId });
  return NextResponse.json(result.view);
}
