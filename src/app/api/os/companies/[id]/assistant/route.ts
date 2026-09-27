import { NextRequest, NextResponse } from 'next/server';
import { askCompanyAssistant, listAssistantTurns } from '@/lib/ai/company/companyAssistant';
import { getCompanyProfile } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The viewer's private assistant thread for this company. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  if (!(await getCompanyProfile(viewer, id))) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json({ turns: await listAssistantTurns(viewer, id) });
}

/** Ask the company assistant. Uses the chosen model credential; budgets and approvals apply. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit({ key: rateLimitKey(request, 'os-assistant'), limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; modelProfileId?: unknown; model?: unknown };
  try {
    const result = await askCompanyAssistant(viewer, id, {
      text: typeof body.text === 'string' ? body.text : '',
      modelProfileId: typeof body.modelProfileId === 'string' ? body.modelProfileId : '',
      model: typeof body.model === 'string' ? body.model : '',
      signal: request.signal,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.reply);
  } catch (error) {
    console.error('[os/assistant] failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'The assistant could not answer. Try again.' }, { status: 500 });
  }
}
