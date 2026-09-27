import { NextRequest, NextResponse } from 'next/server';
import { listPinOptions, pinResource } from '@/lib/integrations/resourcePicker';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

type Params = { params: Promise<{ id: string; provider: string }> };

/** Resources (GA4 properties, Search Console sites, Ahrefs projects) the connected accounts can see. Managers only. */
export async function GET(request: NextRequest, { params }: Params) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id, provider } = await params;
  const options = await listPinOptions(viewer, id, provider);
  if (!options) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(options);
}

/** Pin one of those resources to the company. */
export async function PUT(request: NextRequest, { params }: Params) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id, provider } = await params;
  const body = (await request.json().catch(() => ({}))) as { secretId?: unknown; externalId?: unknown; move?: unknown };
  if (typeof body.secretId !== 'string' || typeof body.externalId !== 'string') {
    return NextResponse.json({ error: 'secretId and externalId are required' }, { status: 400 });
  }
  const result = await pinResource(viewer, id, provider, { secretId: body.secretId, externalId: body.externalId, move: body.move === true });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ label: result.label });
}
