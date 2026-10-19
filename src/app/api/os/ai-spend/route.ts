import { pendingHolds, reconcileHold } from '@/lib/ai/pendingHolds';
import { dollarsToMicros } from '@/lib/ai/settingsSchema';
import { NextRequest, NextResponse } from 'next/server';
import User from '@/lib/models/User';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getOrgAiSpend, isValidPeriod } from '@/lib/ai/spendReport';

export const dynamic = 'force-dynamic';

/** Organization-wide AI spend for a month. Organization administrators only. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const user = await User.findById(viewer.userId).select('isAdmin').lean<{ isAdmin?: boolean }>();
  if (viewer.role !== 'Administrator' && !user?.isAdmin) {
    return NextResponse.json({ error: 'Only administrators can see organization AI spend.' }, { status: 403 });
  }
  const period = request.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
  if (!isValidPeriod(period)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  return NextResponse.json({ ...await getOrgAiSpend(String(viewer.organizationId), period), pendingHolds: await pendingHolds(String(viewer.organizationId), period) }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Reconcile one finished run against confirmed provider usage; never clears all holds blindly. */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const user = await User.findById(viewer.userId).select('isAdmin').lean<{ isAdmin?: boolean }>();
  if (viewer.role !== 'Administrator' && !user?.isAdmin) return NextResponse.json({ error: 'Only administrators can reconcile holds.' }, { status: 403 });
  if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.runId !== 'string' || typeof body.actualUsd !== 'string' || typeof body.reason !== 'string') return NextResponse.json({ error: 'Supply the run, confirmed cost and evidence.' }, { status: 400 });
  try {
    await reconcileHold(String(viewer.organizationId), body.runId, viewer.userId, dollarsToMicros(body.actualUsd), body.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[os/ai-spend] reconciliation failed', { runId: body.runId, error });
    return NextResponse.json({ error: error instanceof Error && !/^Mongo/.test(error.name) ? error.message : 'Reconciliation failed. Refresh to check whether the hold remains before retrying.' }, { status: 409 });
  }
}
