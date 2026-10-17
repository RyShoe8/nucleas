import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { startDueDigests } from '@/lib/watches/digest';
import { resumeStaleArticles } from '@/lib/articles/pipeline';
import { defaultArticleDeps } from '@/lib/articles/deps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Starts digests whose period is over, then advances one waiting article run (digests included). Its own
 * cron so an article run (up to 240 s) never shares a request with mailbox scans.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await connectDB();
    const digests = await startDueDigests({ limit: 2 }).catch((error: unknown) => {
      console.error('[cron/articles] starting digests failed', error instanceof Error ? error.message : 'unknown');
      return { started: 0 };
    });
    const articlesResumed = await resumeStaleArticles(defaultArticleDeps, 1).catch((error: unknown) => {
      console.error('[cron/articles] resuming articles failed', error instanceof Error ? error.message : 'unknown');
      return 0;
    });
    return NextResponse.json({ digestsStarted: digests.started, articlesResumed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[cron/articles] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Article runs unavailable.' }, { status: 503 });
  }
}
