import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { saveWebsiteConnection, testWebsiteConnection, websiteConnectionView, WebsiteConnectionError } from '@/lib/connectors/connections';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  if (error instanceof WebsiteConnectionError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? 'Check the connection settings.' }, { status: 400 });
  console.error('[website-connection] request failed');
  return NextResponse.json({ error: 'The connection request failed. Reload before retrying.' }, { status: 500 });
}
export async function GET(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  try { return NextResponse.json(await websiteConnectionView(viewer, (await params).id), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = await request.json().catch(() => null);
  try {
    const companyId = (await params).id;
    if (body?.action === 'test' && Object.keys(body).length === 1) return NextResponse.json(await testWebsiteConnection(viewer, companyId));
    if (body?.action === 'save') {
      const input = { ...body }; delete input.action;
      return NextResponse.json(await saveWebsiteConnection(viewer, companyId, input));
    }
    return NextResponse.json({ error: 'Choose save or test.' }, { status: 400 });
  } catch (error) { return failure(error); }
}
