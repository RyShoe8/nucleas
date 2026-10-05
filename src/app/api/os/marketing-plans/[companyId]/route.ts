import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getMarketingPlan, updateMarketingPlan } from '@/lib/jobs/marketingPlans';

export async function GET(request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  return NextResponse.json({ plan: await getMarketingPlan(viewer, (await params).companyId) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const result = await updateMarketingPlan(viewer, (await params).companyId, await request.json().catch(() => ({})));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ plan: result.plan });
}
