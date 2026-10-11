import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { facebookRedirectUri, verifyFacebookState } from '@/lib/integrations/facebook/facebookOAuth';
import { completeFacebookConnection } from '@/lib/integrations/facebook/connectFacebook';

function backToOs(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/', request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/** Facebook login callback: requires a valid signed state issued to the same signed-in user. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;

  const params = request.nextUrl.searchParams;
  const state = await verifyFacebookState(params.get('state') ?? '');
  if (!state || state.userId !== viewer.userId) return backToOs(request, { integration_error: 'Sign-in expired. Please try again.' });
  if (params.get('error')) return backToOs(request, { integration_error: 'Facebook sign-in was cancelled.', company: state.companyId });

  const code = params.get('code');
  const redirectUri = facebookRedirectUri(request.url);
  if (!code || !redirectUri) return backToOs(request, { integration_error: 'Missing sign-in code.', company: state.companyId });

  try {
    const result = await completeFacebookConnection(viewer, { code, redirectUri, companyId: state.companyId });
    if (!result.ok) return backToOs(request, { integration_error: result.error, company: state.companyId });
    return backToOs(request, { company: state.companyId, integration_notice: `Facebook Page connected: ${result.pageName}.` });
  } catch (error) {
    console.error('[os/integrations/facebook] callback failed', error instanceof Error ? error.message : 'unknown');
    return backToOs(request, { integration_error: 'Connecting Facebook failed. Please try again.', company: state.companyId });
  }
}
