import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { setCompanyArchived } from '@/lib/companies/archive';

/** { archived: true } archives the company (hidden, nothing runs, all records kept); false restores it. Administrators only. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => null)) as { archived?: unknown } | null;
  if (typeof body?.archived !== 'boolean') return NextResponse.json({ error: 'Send { archived: true } or { archived: false }.' }, { status: 400 });
  const { id } = await params;
  const result = await setCompanyArchived(viewer, id, body.archived);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, archived: body.archived, name: result.name });
}
