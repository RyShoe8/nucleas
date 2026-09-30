import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { syncDueAccounts } from '@/lib/mail/accounts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await connectDB();
    return NextResponse.json(await syncDueAccounts({ olderThanMs: 60_000, limit: 10 }), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // No message content or tokens in an operational error response.
    return NextResponse.json({ error: 'Mail sync unavailable.' }, { status: 503 });
  }
}
