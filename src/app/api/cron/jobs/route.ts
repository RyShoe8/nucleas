import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { claimDueJobRuns, executeJobRun, sweepJobs } from '@/lib/jobs/jobs';
import { runQueuedModelChecks } from '@/lib/ai/engine/modelChecks';
import { verifyDueLinkOpportunities } from '@/lib/jobs/linkOpportunities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 800;

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
    const scheduledRunIds = await claimDueJobRuns(new Date(), 2);
    await Promise.all(scheduledRunIds.map((id) => executeJobRun(id)));
    const linksVerified = await verifyDueLinkOpportunities(new Date(), 10);
    const checks = await runQueuedModelChecks({ budgetMs: 240_000 });
    return NextResponse.json({ ...swept, scheduledRuns: scheduledRunIds.length, linksVerified, modelChecks: checks }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[cron/jobs] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Job sweep failed.' }, { status: 500 });
  }
}
