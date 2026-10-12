import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseWatches, WATCHES_FORBIDDEN } from '@/lib/watches/access';
import { ContentWatch } from '@/lib/models/Watch';
import { scanWatch } from '@/lib/watches/runWatch';
import { draftPostsForNewlyFlagged } from '@/lib/watches/posts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Scans the watch's mailbox now ("Scan now"). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseWatches(viewer)) return NextResponse.json({ error: WATCHES_FORBIDDEN }, { status: 403 });
  const { id } = await params;
  if (!Types.ObjectId.isValid(id) || !(await ContentWatch.exists({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }))) {
    return NextResponse.json({ error: 'Watch not found.' }, { status: 404 });
  }
  const since = new Date();
  const outcome = await scanWatch(id);
  if (outcome.ok) await draftPostsForNewlyFlagged(id, since).catch(() => undefined);
  return outcome.ok
    ? NextResponse.json({ ok: true, stats: outcome.stats })
    : NextResponse.json({ error: outcome.error, needsReauth: outcome.needsReauth ?? false }, { status: outcome.needsReauth ? 409 : 502 });
}
