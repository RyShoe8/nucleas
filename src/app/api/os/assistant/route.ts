import { NextRequest, NextResponse } from 'next/server';
import { askAssistant, listAssistantTurns } from '@/lib/ai/company/companyAssistant';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The viewer's private Nucleas assistant thread. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  return NextResponse.json({ turns: await listAssistantTurns(viewer) });
}

/** Ask Nucleas about any company the viewer can access. Optional focus; budgets and approvals apply. */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit({ key: rateLimitKey(request, 'os-assistant'), limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; focusCompanyId?: unknown; mode?: unknown; modelProfileId?: unknown; model?: unknown };
  try {
    const result = await askAssistant(viewer, {
      text: typeof body.text === 'string' ? body.text : '',
      focusCompanyId: typeof body.focusCompanyId === 'string' ? body.focusCompanyId : undefined,
      mode: body.mode === 'direct' ? 'direct' : 'orchestrated',
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
