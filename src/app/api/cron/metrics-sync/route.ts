import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { processMetricSync } from '@/lib/metrics/sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Hourly-per-company metric sync. Runs often; each company is only synced when due and unleased. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectDB();
    return NextResponse.json(await processMetricSync({ budgetMs: 240_000 }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[cron/metrics-sync] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Metric sync unavailable.' }, { status: 503 });
  }
}
