import { NextRequest, NextResponse } from 'next/server';
import { removeConnection } from '@/lib/integrations/connections';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

/** Remove an integration (and its credential when unused elsewhere). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const result = await removeConnection(viewer, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
