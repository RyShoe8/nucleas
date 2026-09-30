import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { completeGmailConnection } from '@/lib/mail/accounts';
import { gmailRedirectUri, verifyGmailState } from '@/lib/mail/gmailOAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function backToMail(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/', request.url);
  url.searchParams.set('open', 'mail');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/** Google sign-in callback: needs a valid signed state issued to the same signed-in user. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const params = request.nextUrl.searchParams;
  const state = await verifyGmailState(params.get('state') ?? '');
  if (!state || state.userId !== viewer.userId) return backToMail(request, { mail_error: 'Sign-in expired. Please try again.' });
  if (params.get('error')) return backToMail(request, { mail_error: 'Google sign-in was cancelled.' });
  const code = params.get('code');
  const redirectUri = gmailRedirectUri(request.url);
  if (!code || !redirectUri) return backToMail(request, { mail_error: 'Missing sign-in code.' });
  try {
    const result = await completeGmailConnection(viewer, { code, redirectUri, companyId: state.companyId });
    if (!result.ok) return backToMail(request, { mail_error: result.error });
    return backToMail(request, { mail_notice: `${result.emailAddress} connected${result.fetched ? `: ${result.fetched} recent messages synced` : ''}.` });
  } catch (error) {
    console.error('[os/mail/google] callback failed', error instanceof Error ? error.message : 'unknown');
    return backToMail(request, { mail_error: 'Connecting Gmail failed. Please try again.' });
  }
}
