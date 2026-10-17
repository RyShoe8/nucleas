import { after, NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseWatches, WATCHES_FORBIDDEN } from '@/lib/watches/access';
import { ContentWatch } from '@/lib/models/Watch';
import { startDigest } from '@/lib/watches/digest';
import { advanceArticle } from '@/lib/articles/pipeline';
import { defaultArticleDeps } from '@/lib/articles/deps';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** "Write digest now": the current period's flagged emails as a newsletter draft in Content → Articles. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseWatches(viewer)) return NextResponse.json({ error: WATCHES_FORBIDDEN }, { status: 403 });
  const { id } = await params;
  if (!Types.ObjectId.isValid(id) || !(await ContentWatch.exists({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }))) {
    return NextResponse.json({ error: 'Watch not found.' }, { status: 404 });
  }
  const outcome = await startDigest(id, { manual: true });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 409 });
  after(async () => { await advanceArticle(outcome.articleId, defaultArticleDeps); });
  return NextResponse.json({ articleId: outcome.articleId, items: outcome.items }, { status: 201 });
}
