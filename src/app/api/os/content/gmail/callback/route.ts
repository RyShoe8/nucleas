import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { completeWatchMailbox, verifyWatchState, watchRedirectUri } from '@/lib/watches/mailboxes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function backToContent(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/', request.url);
  url.searchParams.set('open', 'content');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/** Google sign-in callback: needs a valid signed state issued to the same signed-in user. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const params = request.nextUrl.searchParams;
  const state = await verifyWatchState(params.get('state') ?? '');
  if (!state || state.userId !== viewer.userId) return backToContent(request, { integration_error: 'Sign-in expired. Please try again.' });
  if (params.get('error')) return backToContent(request, { integration_error: 'Google sign-in was cancelled.' });
  const code = params.get('code');
  const redirectUri = watchRedirectUri(request.url);
  if (!code || !redirectUri) return backToContent(request, { integration_error: 'Missing sign-in code.' });
  try {
    const result = await completeWatchMailbox(viewer, { code, redirectUri });
    if (!result.ok) return backToContent(request, { integration_error: result.error });
    return backToContent(request, { integration_notice: `${result.emailAddress} connected for content watches.` });
  } catch (error) {
    console.error('[os/content/gmail] callback failed', error instanceof Error ? error.message : 'unknown');
    return backToContent(request, { integration_error: 'Connecting the mailbox failed. Please try again.' });
  }
}
