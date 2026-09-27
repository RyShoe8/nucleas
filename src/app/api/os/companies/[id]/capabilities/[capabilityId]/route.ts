import { NextRequest, NextResponse } from 'next/server';
import { invokeCapability } from '@/lib/capabilities/runtime';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';

/** Invoke a capability for a company. Returns the receipt (or a cached recent read). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; capabilityId: string }> }) {
  try {
    const limited = enforceRateLimit({ key: rateLimitKey(request, 'os-capability'), limit: 60, windowMs: 60_000 });
    if (limited) return limited;
    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;
    const { id, capabilityId } = await params;
    const body = (await request.json().catch(() => ({}))) as { input?: unknown };
    const result = await invokeCapability(viewer, id, capabilityId, body.input ?? {});
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ invocation: result.invocation });
  } catch (error) {
    console.error('[os/capabilities] invoke failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
