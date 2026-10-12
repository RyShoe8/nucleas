import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { listItems, type ItemFilter } from '@/lib/watches/watches';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const q = request.nextUrl.searchParams;
  const filter = (['flagged', 'scored', 'all'] as const).find((f) => f === q.get('filter')) as ItemFilter | undefined;
  const result = await listItems(viewer, id, { filter, before: q.get('before') ?? undefined, limit: Number(q.get('limit')) || undefined });
  return result.ok ? NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: result.error }, { status: result.status });
}
