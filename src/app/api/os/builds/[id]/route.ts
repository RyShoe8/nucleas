import { after, NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import {
  approveBuild,
  discardBuild,
  editPlan,
  getBuild,
  openPullRequest,
  rejectBuild,
  retryBuild,
  runBuild,
  type ActionResult,
} from '@/lib/building/builds';

export const dynamic = 'force-dynamic';
// Approving starts the build right after the response; the build service stops at four minutes.
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const build = await getBuild(viewer, (await params).id);
  if (!build) return NextResponse.json({ error: 'Build not found.' }, { status: 404 });
  return NextResponse.json({ build }, { headers: { 'Cache-Control': 'no-store' } });
}

/** { action: approve | edit | reject | retry | discard | open_pr, planMarkdown?, title?, reason? } */
export async function POST(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const id = (await params).id;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; planMarkdown?: unknown; title?: unknown; reason?: unknown };
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  let result: ActionResult;
  switch (body.action) {
    case 'approve':
      result = await approveBuild(viewer, id, { planMarkdown: text(body.planMarkdown) });
      break;
    case 'edit':
      result = await editPlan(viewer, id, { planMarkdown: text(body.planMarkdown) ?? '', title: text(body.title) });
      break;
    case 'reject':
      result = await rejectBuild(viewer, id, text(body.reason));
      break;
    case 'retry':
      result = await retryBuild(viewer, id);
      break;
    case 'discard':
      result = await discardBuild(viewer, id);
      break;
    case 'open_pr':
      result = await openPullRequest(viewer, id);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.build.status === 'queued') after(() => runBuild(id));
  return NextResponse.json({ build: result.build });
}
