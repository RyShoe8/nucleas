import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { sendDueAttentionDigests } from '@/lib/attention/digest';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? ''), expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await connectDB();
  return NextResponse.json(await sendDueAttentionDigests(), { headers: { 'Cache-Control': 'no-store' } });
}
