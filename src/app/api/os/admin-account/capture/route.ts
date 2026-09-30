import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';
import { captureWithCode } from '@/lib/companies/adminAccount';

export const dynamic = 'force-dynamic';

/**
 * The capture script's upload: { code, storageState } from a person who logged in on their own machine.
 * Authorised by the one-time code (15 minutes, spent on use), so it needs no Nucleas login.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit({ key: rateLimitKey(request, 'admin-account-capture'), limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  const text = await request.text();
  if (text.length > 200_000) return NextResponse.json({ error: 'That session is too large.' }, { status: 413 });
  let body: { code?: unknown; storageState?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (typeof body.code !== 'string' || body.code.length > 40) return NextResponse.json({ error: 'A code is required.' }, { status: 400 });
  const result = await captureWithCode(body.code, body.storageState);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, host: result.host, cookies: result.count });
}
