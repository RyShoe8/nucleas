import { NextRequest, NextResponse } from 'next/server';
import { loginFirstForConnection } from '@/lib/auth/connectionStart';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile } from '@/lib/companies/companyProfile';
import { canUseMail, MAIL_FORBIDDEN } from '@/lib/mail/accounts';
import { buildGmailAuthUrl, createGmailState, gmailRedirectUri } from '@/lib/mail/gmailOAuth';

export const dynamic = 'force-dynamic';

const desktopFlowOf = (request: NextRequest) => {
  const flow = request.nextUrl.searchParams.get('desktopFlow') ?? '';
  return /^[a-f0-9]{32}$/.test(flow) ? flow : undefined;
};

/** Starts Google sign-in for one Gmail mailbox. Optional ?companyId= files it under a company. */
export async function GET(request: NextRequest) {
  const login = await loginFirstForConnection(request);
  if (login) return login;
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseMail(viewer)) return NextResponse.json({ error: MAIL_FORBIDDEN }, { status: 403 });
  const companyId = request.nextUrl.searchParams.get('companyId');
  if (companyId && !(await getCompanyProfile(viewer, companyId))) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  const clientId = process.env.GOOGLE_MAIL_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID;
  const redirectUri = gmailRedirectUri(request.url);
  if (!clientId || !redirectUri) return NextResponse.json({ error: 'Google sign-in is not available on this host.' }, { status: 500 });
  const state = await createGmailState(viewer.userId, companyId || null, desktopFlowOf(request));
  return NextResponse.redirect(buildGmailAuthUrl({ clientId, redirectUri, state }));
}
