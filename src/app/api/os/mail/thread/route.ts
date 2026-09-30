import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseMail, MAIL_FORBIDDEN } from '@/lib/mail/accounts';
import { getThread } from '@/lib/mail/messages';

export const dynamic = 'force-dynamic';

/** One conversation with full bodies: ?accountId=&threadId= */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseMail(viewer)) return NextResponse.json({ error: MAIL_FORBIDDEN }, { status: 403 });
  const p = request.nextUrl.searchParams;
  const messages = await getThread(viewer, p.get('accountId') ?? '', p.get('threadId') ?? '');
  if (!messages?.length) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  return NextResponse.json({ messages }, { headers: { 'Cache-Control': 'no-store' } });
}
