import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { sweepJobs } from '@/lib/jobs/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Fails job runs and designs that have been stuck too long. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectDB();
    return NextResponse.json(await sweepJobs(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[cron/jobs] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Job sweep failed.' }, { status: 500 });
  }
}
