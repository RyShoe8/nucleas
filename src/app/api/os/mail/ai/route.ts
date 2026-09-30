import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { draftReply, jobFromThread, summarizeThread } from '@/lib/mail/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** AI help for a conversation: { action: 'summarize' | 'draft' | 'job', accountId, threadId, instruction?, companyId? } */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const accountId = typeof b.accountId === 'string' ? b.accountId : '';
  const threadId = typeof b.threadId === 'string' ? b.threadId : '';
  if (!accountId || !threadId) return NextResponse.json({ error: 'accountId and threadId are required.' }, { status: 400 });
  const result =
    b.action === 'summarize' ? await summarizeThread(viewer, accountId, threadId)
    : b.action === 'draft' ? await draftReply(viewer, { accountId, threadId, instruction: typeof b.instruction === 'string' ? b.instruction : undefined })
    : b.action === 'job' ? await jobFromThread(viewer, { accountId, threadId, companyId: typeof b.companyId === 'string' ? b.companyId : undefined })
    : null;
  if (!result) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  return result.ok ? NextResponse.json(result.data) : NextResponse.json({ error: result.error }, { status: result.status });
}
