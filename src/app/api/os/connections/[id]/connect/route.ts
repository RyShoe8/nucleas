import { NextRequest, NextResponse } from 'next/server';
import { connectWithApiKey } from '@/lib/integrations/connections';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';

/** Verify and store an API credential. The credential is never echoed back. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = enforceRateLimit({ key: rateLimitKey(request, 'os-connect'), limit: 10, windowMs: 60_000 });
    if (limited) return limited;

    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as { credential?: unknown } | null;
    const result = await connectWithApiKey(viewer, id, typeof body?.credential === 'string' ? body.credential : '');
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ connection: result.connection });
  } catch (error) {
    console.error('[os/connections/connect] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
