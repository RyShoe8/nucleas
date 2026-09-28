import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { sweepJobs } from '@/lib/jobs/jobs';
import { runQueuedModelChecks } from '@/lib/ai/engine/modelChecks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Fails job runs and designs that have been stuck too long, and finishes any queued free-model checks. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectDB();
    const swept = await sweepJobs();
    const checks = await runQueuedModelChecks({ budgetMs: 240_000 });
    return NextResponse.json({ ...swept, modelChecks: checks }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[cron/jobs] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Job sweep failed.' }, { status: 500 });
  }
}
