import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { scanDueWatches } from '@/lib/watches/runWatch';
import { draftPostsForNewlyFlagged } from '@/lib/watches/posts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Scans the content watches whose interval has passed, within one time budget. Digests and articles run on /api/cron/articles. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await connectDB();
    const scanned = await scanDueWatches({ limit: 3, budgetMs: 220_000, afterScan: (watchId, since) => draftPostsForNewlyFlagged(watchId, since) });
    return NextResponse.json(scanned, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[cron/watches] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Watch scan unavailable.' }, { status: 503 });
  }
}
