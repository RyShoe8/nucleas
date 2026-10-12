import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { scanDueWatches } from '@/lib/watches/runWatch';
import { draftPostsForNewlyFlagged } from '@/lib/watches/posts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Scans the content watches whose interval has passed. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await connectDB();
    return NextResponse.json(await scanDueWatches({ limit: 3, afterScan: (watchId, since) => draftPostsForNewlyFlagged(watchId, since) }), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Watch scan unavailable.' }, { status: 503 });
  }
}
