import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseWatches, WATCHES_FORBIDDEN } from '@/lib/watches/access';
import { queueExistingAdminItem } from '@/lib/publishing/engine';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseWatches(viewer)) return NextResponse.json({ error: WATCHES_FORBIDDEN }, { status: 403 });
  try { return NextResponse.json(await queueExistingAdminItem(viewer, (await params).id)); }
  catch (error) {
    console.error('[publishing/admin] queue existing email failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not prepare the admin card.' }, { status: 409 });
  }
}
