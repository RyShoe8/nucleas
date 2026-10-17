import { after, NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseWatches, WATCHES_FORBIDDEN } from '@/lib/watches/access';
import { ContentWatch } from '@/lib/models/Watch';
import { scanWatch } from '@/lib/watches/runWatch';
import { draftPostsForNewlyFlagged } from '@/lib/watches/posts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Leave this long after a scan for drafting posts; with less, the next scheduled scan's drafting is left to catch up. */
const POST_DRAFT_RESERVE_MS = 60_000;

/**
 * "Scan now": starts the scan in the background and answers at once (202), so a long scan never times
 * the browser out. The window follows it through the watch's scanning state, progress and scan log.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseWatches(viewer)) return NextResponse.json({ error: WATCHES_FORBIDDEN }, { status: 403 });
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: 'Watch not found.' }, { status: 404 });
  const watch = await ContentWatch.findOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }).select('_id scanLeaseUntil').lean<{ _id: Types.ObjectId; scanLeaseUntil?: Date }>();
  if (!watch) return NextResponse.json({ error: 'Watch not found.' }, { status: 404 });
  if (watch.scanLeaseUntil && watch.scanLeaseUntil.getTime() > Date.now()) return NextResponse.json({ error: 'This watch is already being scanned.' }, { status: 409 });
  const started = Date.now();
  after(async () => {
    try {
      const since = new Date();
      const outcome = await scanWatch(id);
      if (!outcome.ok) return;
      if (Date.now() - started > 300_000 - POST_DRAFT_RESERVE_MS) {
        console.info(`[watches] ${id} post drafting skipped after the manual scan: not enough time left`);
        return;
      }
      const drafted = await draftPostsForNewlyFlagged(id, since);
      if (drafted.drafted) console.info(`[watches] ${id} drafted ${drafted.drafted} post${drafted.drafted === 1 ? '' : 's'} after the manual scan`);
    } catch (error) {
      console.error(`[watches] ${id} manual scan crashed`, error instanceof Error ? error.stack ?? error.message : 'unknown');
    }
  });
  return NextResponse.json({ started: true }, { status: 202 });
}
