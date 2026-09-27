import { NextRequest, NextResponse } from 'next/server';
import { addConnection, listAddableProviders } from '@/lib/integrations/connections';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

/** Integrations that can still be added to this company. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const providers = await listAddableProviders(viewer, id);
  if (!providers) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json({ providers });
}

/** Add an integration to this company as not-yet-connected. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { provider?: unknown } | null;
  const result = await addConnection(viewer, id, typeof body?.provider === 'string' ? body.provider : '');
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true }, { status: 201 });
}
