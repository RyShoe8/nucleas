import { after, NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import {
  answerQuestions,
  approveJob,
  archiveJob,
  decideRun,
  executeJobRun,
  getJob,
  pauseJob,
  rejectJob,
  resumeJob,
  runDesign,
  runNow,
  type ActionResult,
} from '@/lib/jobs/jobs';
import { updateLinkOpportunity, verifyLinkOpportunity, viewerOwnsOpportunity } from '@/lib/jobs/linkOpportunities';

export const dynamic = 'force-dynamic';
// Runs and redesigns continue after the response.
// Research jobs may need several source/tool rounds. Fluid Compute supports this ceiling;
// progress is persisted throughout and the idle-run sweeper still recovers abandoned work.
export const maxDuration = 800;
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const job = await getJob(viewer, (await params).id);
  if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  return NextResponse.json({ job }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * { action: answer | approve | reject | run_now | accept_run | reject_run | pause | resume | archive, ... }
 *   answer: { answers: { [questionId]: { option?, text? } } }
 *   approve: { completion: 'review' | 'automatic', monthlyBudgetUsd? }
 *   accept_run / reject_run: { runId, note? }
 */
export async function POST(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const id = (await params).id;
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    answers?: unknown;
    completion?: unknown;
    monthlyBudgetUsd?: unknown;
    runId?: unknown;
    note?: unknown;
    opportunityId?: unknown;
    status?: unknown;
    liveLinkUrl?: unknown;
  };
  const note = typeof body.note === 'string' ? body.note : undefined;
  let result: ActionResult & { runId?: string; dryRunId?: string };
  switch (body.action) {
    case 'answer': {
      const answers = body.answers && typeof body.answers === 'object' ? (body.answers as Record<string, { option?: string; text?: string }>) : {};
      result = await answerQuestions(viewer, id, answers);
      if (result.ok) after(() => runDesign(viewer, id));
      break;
    }
    case 'approve':
      result = await approveJob(viewer, id, {
        completion: body.completion === 'automatic' ? 'automatic' : body.completion === 'review' ? 'review' : ('' as 'review'),
        monthlyBudgetMicros: typeof body.monthlyBudgetUsd === 'number' ? Math.round(body.monthlyBudgetUsd * 1_000_000) : undefined,
      });
      break;
    case 'reject':
      result = await rejectJob(viewer, id, note);
      break;
    case 'run_now':
      result = await runNow(viewer, id);
      break;
    case 'accept_run':
    case 'reject_run':
      result = await decideRun(viewer, id, typeof body.runId === 'string' ? body.runId : '', body.action === 'accept_run' ? 'accept' : 'reject', note);
      break;
    case 'pause':
      result = await pauseJob(viewer, id);
      break;
    case 'resume':
      result = await resumeJob(viewer, id);
      break;
    case 'archive':
      result = await archiveJob(viewer, id);
      break;
    case 'opportunity_status': {
      const updated = await updateLinkOpportunity(viewer, id, typeof body.opportunityId === 'string' ? body.opportunityId : '', {
        status: body.status,
        note: body.note,
        liveLinkUrl: body.liveLinkUrl,
      });
      if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: updated.status });
      const job = await getJob(viewer, id);
      if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
      result = { ok: true, job };
      break;
    }
    case 'verify_opportunity': {
      if (typeof body.opportunityId !== 'string' || !(await viewerOwnsOpportunity(viewer, id, body.opportunityId))) {
        return NextResponse.json({ error: 'Opportunity not found.' }, { status: 404 });
      }
      await verifyLinkOpportunity(body.opportunityId);
      const job = await getJob(viewer, id);
      if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
      result = { ok: true, job };
      break;
    }
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const runId = result.runId ?? result.dryRunId;
  if (runId) after(() => executeJobRun(runId));
  return NextResponse.json({ job: result.job });
}
