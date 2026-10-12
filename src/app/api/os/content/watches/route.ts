import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseWatches, WATCHES_FORBIDDEN } from '@/lib/watches/access';
import { createWatch, listWatches } from '@/lib/watches/watches';
import { listMailboxes } from '@/lib/watches/mailboxes';

export const dynamic = 'force-dynamic';

/** The viewer's watches and connected mailboxes. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseWatches(viewer)) return NextResponse.json({ error: WATCHES_FORBIDDEN }, { status: 403 });
  const [watches, mailboxes] = await Promise.all([listWatches(viewer), listMailboxes(viewer)]);
  return NextResponse.json({ watches: watches ?? [], mailboxes: mailboxes ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = await request.json().catch(() => null);
  const result = await createWatch(viewer, body);
  return result.ok ? NextResponse.json({ watch: result.data }, { status: 201 }) : NextResponse.json({ error: result.error }, { status: result.status });
}
