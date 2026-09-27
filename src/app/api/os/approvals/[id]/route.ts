import { NextRequest, NextResponse } from 'next/server';
import { decideApproval } from '@/lib/capabilities/runtime';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

/** Approve or deny one pending action. Managers only; each approval is consumed once. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { decision?: unknown };
    if (body.decision !== 'approve' && body.decision !== 'deny') {
      return NextResponse.json({ error: 'decision must be approve or deny' }, { status: 400 });
    }
    const result = await decideApproval(viewer, id, body.decision);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ invocation: result.invocation });
  } catch (error) {
    console.error('[os/approvals] decide failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
