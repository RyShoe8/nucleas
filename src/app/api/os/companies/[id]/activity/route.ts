import { NextRequest, NextResponse } from 'next/server';
import { listInvocations } from '@/lib/capabilities/runtime';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

/** Action receipts for a company. Routine successful reads are hidden unless ?includeReads=1. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const includeReads = request.nextUrl.searchParams.get('includeReads') === '1';
  const items = await listInvocations(viewer, id, { includeReads, limit: 30 });
  if (!items) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json({ items });
}
