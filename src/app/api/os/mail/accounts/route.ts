import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseMail, listAccounts, MAIL_FORBIDDEN } from '@/lib/mail/accounts';
import { mailCounts } from '@/lib/mail/messages';

export const dynamic = 'force-dynamic';

/** Connected mailboxes (never their tokens) with unread counts, and the counts for each place in Mail. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseMail(viewer)) return NextResponse.json({ error: MAIL_FORBIDDEN }, { status: 403 });
  const [accounts, counts] = await Promise.all([listAccounts(viewer), mailCounts(viewer)]);
  return NextResponse.json({ accounts, counts, googleConfigured: Boolean((process.env.GOOGLE_MAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) && (process.env.GOOGLE_MAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)) }, { headers: { 'Cache-Control': 'no-store' } });
}
