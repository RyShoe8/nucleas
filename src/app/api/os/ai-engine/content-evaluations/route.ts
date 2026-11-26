import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import User from '@/lib/models/User';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { listAvailableModels } from '@/lib/ai/engine/catalog';
import { ContentEvaluation, gradeContentEvaluation, runContentEvaluation } from '@/lib/ai/engine/contentEvaluations';
import { CONTENT_CASES, CONTENT_SUITE_VERSION } from '@/lib/ai/eval/contentCases';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
async function admin(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const user = await User.findById(viewer.userId).select('isAdmin').lean();
  return viewer.role === 'Administrator' || user?.isAdmin ? viewer : NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });
}
export async function GET(request: NextRequest) {
  const viewer = await admin(request);
  if (viewer instanceof NextResponse) return viewer;
  const runs = await ContentEvaluation.find({ organizationId: viewer.organizationId }).sort({ createdAt: -1 }).limit(20).lean();
  return NextResponse.json({ cases: CONTENT_CASES, suite: CONTENT_SUITE_VERSION, runs: runs.map(r => ({ ...r, id: String(r._id) })) }, { headers: { 'Cache-Control': 'no-store' } });
}
const id = z.string().regex(/^[a-f\d]{24}$/i);
const grade = z.object({ caseId: z.string().max(80), factuality: z.number().int().min(0).max(4), coverage: z.number().int().min(0).max(4), voice: z.number().int().min(0).max(4), originality: z.number().int().min(0).max(4), criticalError: z.boolean(), notes: z.string().trim().min(3).max(1500) });
const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('run'), profileId: id, model: z.string().min(1).max(200), need: z.enum(['write', 'review']) }),
  z.object({ action: z.literal('grade'), id, grades: z.array(grade).length(CONTENT_CASES.length) }),
]);
export async function POST(request: NextRequest) {
  const viewer = await admin(request);
  if (viewer instanceof NextResponse) return viewer;
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose a model and task, or score and explain every test case.' }, { status: 400 });
  const body = parsed.data, organizationId = String(viewer.organizationId);
  if (body.action === 'grade') {
    const ok = await gradeContentEvaluation(organizationId, body.id, viewer.userId, body.grades);
    return NextResponse.json(ok ? { ok: true } : { error: 'This evaluation is incomplete, already reviewed, or not in this organization.' }, { status: ok ? 200 : 409 });
  }
  const models = await listAvailableModels();
  if (!models.some(m => m.profileId === body.profileId && m.model === body.model && !m.benched && (m.autoEligible || m.free))) return NextResponse.json({ error: 'Choose an available model.' }, { status: 400 });
  await ContentEvaluation.updateMany({ organizationId, status: 'running', updatedAt: { $lt: new Date(Date.now() - 6 * 60_000) } }, { $set: { status: 'failed', error: 'Evaluation timed out. Partial results are retained.' } });
  try {
    const run = await ContentEvaluation.create({ organizationId, profileId: body.profileId, model: body.model, need: body.need, suite: CONTENT_SUITE_VERSION, status: 'running', createdBy: viewer.userId });
    after(() => runContentEvaluation(String(run._id), viewer.userId));
    return NextResponse.json({ id: String(run._id) }, { status: 202 });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return NextResponse.json({ error: 'An evaluation is already running.' }, { status: 409 });
    throw error;
  }
}
