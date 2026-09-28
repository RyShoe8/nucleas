import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { sweepBuilds } from '@/lib/building/builds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Starts approved builds still waiting in the queue and times out stuck ones. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectDB();
    return NextResponse.json(await sweepBuilds(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[cron/builds] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Build sweep failed.' }, { status: 500 });
  }
}
