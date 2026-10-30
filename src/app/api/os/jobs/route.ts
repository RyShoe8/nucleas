import { after, NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { isCostLevel } from '@/lib/ai/engine/select';
import { createCasinoDiscovery } from '@/lib/casinoDiscovery/create';
import { getJob } from '@/lib/jobs/jobs';
import { createJob, createPublishing, createTemplateJob, executeJobRun, listJobs, runDesign } from '@/lib/jobs/jobs';
import type { ConfirmedUnderstanding } from '@/lib/jobs/designer';

export const dynamic = 'force-dynamic';
// Designing continues after the response (Nucleas investigates, then designs or asks).
export const maxDuration = 300;

/** Jobs across every company the viewer can see. ?all=1 includes rejected and archived; ?companyId= narrows. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const jobs = await listJobs(viewer, {
    includeClosed: request.nextUrl.searchParams.get('all') === '1',
    companyId: request.nextUrl.searchParams.get('companyId') ?? undefined,
  });
  return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } });
}

/** A new job from a request: { companyId, request, level? }. Returns at once; Nucleas designs it in the background. */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { companyId?: unknown; request?: unknown; level?: unknown; template?: unknown; config?: unknown; understanding?: unknown };
  if (typeof body.companyId !== 'string') {
    return NextResponse.json({ error: 'companyId is required.' }, { status: 400 });
  }
  if (body.template === 'casino_discovery') {
    try { const id = await createCasinoDiscovery(viewer, body.companyId); return NextResponse.json({ job: await getJob(viewer, id) }); }
    catch(error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not configure discovery.' }, { status: 400 }); }
  }
  if (body.template === 'social_publish') {
    // The confirmed plan from /api/os/jobs/plan; the dry run starts straight away.
    const result = await createPublishing(viewer, { ...(body.config && typeof body.config === 'object' ? body.config : {}), companyId: body.companyId });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    if (result.dryRunId) after(() => executeJobRun(result.dryRunId!));
    return NextResponse.json({ job: result.job });
  }
  if (body.template === 'link_building' || body.template === 'seo_brief' || body.template === 'marketing_plan' || body.template === 'brand_voice') {
    const result = await createTemplateJob(viewer, {
      companyId: body.companyId,
      template: body.template,
      config: body.config,
      level: isCostLevel(body.level) ? body.level : undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ job: result.job });
  }
  if (typeof body.request !== 'string') {
    return NextResponse.json({ error: 'request is required.' }, { status: 400 });
  }
  const result = await createJob(viewer, { companyId: body.companyId, request: body.request, level: isCostLevel(body.level) ? body.level : undefined, background: true, understanding: confirmedUnderstanding(body.understanding) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  after(() => runDesign(viewer, result.job.id));
  return NextResponse.json({ job: result.job });
}

/** The understanding the person confirmed (from /api/os/jobs/understand), bounded; anything malformed is dropped. */
function confirmedUnderstanding(raw: unknown): ConfirmedUnderstanding | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const needs = Array.isArray(o.needs)
    ? o.needs.slice(0, 10).flatMap((n) => {
        const r = n && typeof n === 'object' ? (n as Record<string, unknown>) : {};
        const label = str(r.label, 160);
        return label ? [{ label, status: str(r.status, 20) ?? 'action', detail: str(r.detail, 300) }] : [];
      })
    : undefined;
  const out: ConfirmedUnderstanding = { kind: str(o.kind, 40), summary: str(o.summary, 600), brief: str(o.brief, 3000), needs };
  return out.summary || out.brief ? out : undefined;
}
