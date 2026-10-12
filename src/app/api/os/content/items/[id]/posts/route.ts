import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseWatches, WATCHES_FORBIDDEN } from '@/lib/watches/access';
import { draftPostsForItem } from '@/lib/watches/posts';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Drafts social posts for one scanned email, in the watch company's Voice. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseWatches(viewer)) return NextResponse.json({ error: WATCHES_FORBIDDEN }, { status: 403 });
  const { id } = await params;
  const result = await draftPostsForItem(viewer.organizationId, viewer.userId, id, { source: 'manual' });
  return result.ok ? NextResponse.json(result.data, { status: result.data.created ? 201 : 200 }) : NextResponse.json({ error: result.error }, { status: result.status });
}
