import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { executeJobRun } from '@/lib/jobs/jobs';
import { nextQueuedRunId } from '@/lib/jobs/runLifecycle';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

/** Starts the next queued job run in a process of its own, so it gets its full time. A finishing run calls this. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectDB();
    const runId = await nextQueuedRunId();
    if (runId) await executeJobRun(runId);
    return NextResponse.json({ started: runId });
  } catch (error) {
    console.error('[cron/job-queue] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'The job queue could not start the next run.' }, { status: 500 });
  }
}
