import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { googleIntegrationRedirectUri, verifyGoogleIntegrationState } from '@/lib/integrations/google/googleOAuth';
import { completeGoogleConnection } from '@/lib/integrations/google/connectGoogle';

function backToOs(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/', request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/** Google OAuth callback: requires a valid signed state issued to the same signed-in user. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;

  const params = request.nextUrl.searchParams;
  const state = await verifyGoogleIntegrationState(params.get('state') ?? '');
  if (!state || state.userId !== viewer.userId) return backToOs(request, { integration_error: 'Sign-in expired. Please try again.' });
  if (params.get('error')) return backToOs(request, { integration_error: 'Google sign-in was cancelled.', company: state.companyId });

  const code = params.get('code');
  const redirectUri = googleIntegrationRedirectUri(request.url);
  if (!code || !redirectUri) return backToOs(request, { integration_error: 'Missing sign-in code.', company: state.companyId });

  try {
    const result = await completeGoogleConnection(viewer, { code, redirectUri });
    if (!result.ok) return backToOs(request, { integration_error: result.error, company: state.companyId });
    const s = result.summary;
    return backToOs(request, {
      company: state.companyId,
      integration_notice: `Google (${s.accountEmail}): Analytics connected for ${s.analytics.connected.length}, Search Console for ${s.searchConsole.connected.length}, AdSense for ${s.adsense.connected.length} companies.${s.adsense.error ? ' AdSense: ' + s.adsense.error : ''}`,
    });
  } catch (error) {
    console.error('[os/integrations/google] callback failed', error instanceof Error ? error.message : 'unknown');
    return backToOs(request, { integration_error: 'Connecting Google failed. Please try again.', company: state.companyId });
  }
}
