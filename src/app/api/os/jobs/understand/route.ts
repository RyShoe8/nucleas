import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { understandRequest, type Answers, type Understanding } from '@/lib/jobs/understand';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** { companyId, request, answers?, previous? } → what Nucleas understood: kind, summary, needs, questions, brief. Creates nothing. */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { companyId?: unknown; request?: unknown; answers?: unknown; previous?: unknown };
  if (typeof body.companyId !== 'string' || typeof body.request !== 'string') return NextResponse.json({ error: 'companyId and request are required.' }, { status: 400 });
  const answers = body.answers && typeof body.answers === 'object' ? (body.answers as Answers) : undefined;
  const previous = body.previous && typeof body.previous === 'object' && Array.isArray((body.previous as { questions?: unknown }).questions) ? (body.previous as Pick<Understanding, 'questions'>) : undefined;
  const result = await understandRequest(viewer, { companyId: body.companyId, request: body.request, answers, previous });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ understanding: result.understanding }, { headers: { 'Cache-Control': 'no-store' } });
}
