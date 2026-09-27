import { NextRequest, NextResponse } from 'next/server';
import { setUpCompanyEvents } from '@/lib/integrations/companyEvents';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

/** Generate (or rotate) a company's signed event endpoint. The secret is returned once. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const result = await setUpCompanyEvents(viewer, id, request.nextUrl.origin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ url: result.url, secret: result.secret }, { headers: { 'Cache-Control': 'no-store' } });
}
