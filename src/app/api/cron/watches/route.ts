import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { scanDueWatches } from '@/lib/watches/runWatch';
import { draftPostsForNewlyFlagged } from '@/lib/watches/posts';
import { resumeStaleArticles } from '@/lib/articles/pipeline';
import { defaultArticleDeps } from '@/lib/articles/deps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Scans the content watches whose interval has passed, then resumes any article runs that were cut off. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await connectDB();
    const scanned = await scanDueWatches({ limit: 3, afterScan: (watchId, since) => draftPostsForNewlyFlagged(watchId, since) });
    const articlesResumed = await resumeStaleArticles(defaultArticleDeps, 1).catch(() => 0);
    return NextResponse.json({ ...scanned, articlesResumed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Watch scan unavailable.' }, { status: 503 });
  }
}
