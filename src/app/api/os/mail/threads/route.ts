import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseMail, MAIL_FORBIDDEN } from '@/lib/mail/accounts';
import { listThreads, type MailView } from '@/lib/mail/messages';

export const dynamic = 'force-dynamic';
const VIEWS: MailView[] = ['inbox', 'unread', 'starred', 'sent', 'all', 'updates', 'promotions', 'suspicious'];

/** Conversations: ?view=&accountId=&companyId=&q=&before=&limit= */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseMail(viewer)) return NextResponse.json({ error: MAIL_FORBIDDEN }, { status: 403 });
  const p = request.nextUrl.searchParams;
  const view = (VIEWS as string[]).includes(p.get('view') ?? '') ? (p.get('view') as MailView) : 'inbox';
  const threads = await listThreads(viewer, {
    view,
    accountId: p.get('accountId') ?? undefined,
    companyId: p.get('companyId') ?? undefined,
    q: p.get('q') ?? undefined,
    before: p.get('before') ?? undefined,
    limit: Number(p.get('limit')) || 50,
  });
  return NextResponse.json({ threads }, { headers: { 'Cache-Control': 'no-store' } });
}
