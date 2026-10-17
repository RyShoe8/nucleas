import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { designWatch } from '@/lib/watches/design';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Drafts a watch from one sentence for the person to review; nothing is saved. */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => null)) as { request?: unknown; companyId?: unknown } | null;
  const result = await designWatch(viewer, { request: typeof body?.request === 'string' ? body.request : '', companyId: typeof body?.companyId === 'string' && body.companyId ? body.companyId : null });
  return result.ok ? NextResponse.json({ design: result.design }) : NextResponse.json({ error: result.error }, { status: result.status });
}
