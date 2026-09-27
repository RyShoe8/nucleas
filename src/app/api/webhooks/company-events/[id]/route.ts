import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import { receiveCompanyEvent } from '@/lib/integrations/companyEvents';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';

export const dynamic = 'force-dynamic';

/** Signed first-party events from a company's platform. Authenticated by HMAC, not a session. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit({ key: rateLimitKey(request, 'company-events'), limit: 300, windowMs: 60_000 });
  if (limited) return limited;
  const raw = await request.text();
  if (raw.length > 10_000) return NextResponse.json({ error: 'Body too large' }, { status: 413 });
  try {
    await connectDB();
    const { id } = await params;
    const result = await receiveCompanyEvent(id, { timestamp: request.headers.get('x-nucleas-timestamp'), signature: request.headers.get('x-nucleas-signature') }, raw);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[webhooks/company-events] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
