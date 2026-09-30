import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { sendMail } from '@/lib/mail/messages';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Send or reply from a connected mailbox: { accountId, to, cc?, bcc?, subject, text, replyToMessageId? } */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const result = await sendMail(viewer, {
    accountId: str(b.accountId),
    to: str(b.to),
    cc: str(b.cc),
    bcc: str(b.bcc),
    subject: str(b.subject).slice(0, 500),
    text: str(b.text).slice(0, 100_000),
    ...(str(b.replyToMessageId) ? { replyToMessageId: str(b.replyToMessageId) } : {}),
  });
  return result.ok ? NextResponse.json({ ok: true, threadId: result.threadId }) : NextResponse.json({ error: result.error }, { status: result.status });
}
