import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { runCompanySync } from '@/lib/metrics/sync';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';

export const maxDuration = 120;

/** Manual "Sync now" for one company. Managers only; never overlaps a running sync. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit({ key: rateLimitKey(request, 'os-metric-sync'), limit: 6, windowMs: 60_000 });
  if (limited) return limited;
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Only managers can sync.' }, { status: 403 });
  const { id } = await params;
  if (!(await getCompanyProfile(viewer, id))) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  try {
    const res = await runCompanySync({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }, { force: true });
    if (res.status === 'busy') return NextResponse.json({ error: 'A sync is already running for this company.' }, { status: 409 });
    return NextResponse.json({ written: res.result?.written ?? 0, results: res.result?.results ?? [] });
  } catch (error) {
    console.error('[os/metrics/sync] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Sync failed.' }, { status: 500 });
  }
}
