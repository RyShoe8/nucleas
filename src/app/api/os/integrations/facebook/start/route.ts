import { NextRequest, NextResponse } from 'next/server';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { buildFacebookAuthUrl, createFacebookState, facebookRedirectUri } from '@/lib/integrations/facebook/facebookOAuth';

/** Starts Facebook login for one company's Page. Managers only. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Only managers can connect integrations.' }, { status: 403 });

  const companyId = request.nextUrl.searchParams.get('companyId') ?? '';
  if (!(await getCompanyProfile(viewer, companyId))) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const redirectUri = facebookRedirectUri(request.url);
  if (!appId || !process.env.FACEBOOK_APP_SECRET?.trim()) {
    return NextResponse.json({ error: 'Facebook sign-in is not configured. Paste a Page access token instead.' }, { status: 503 });
  }
  if (!redirectUri) return NextResponse.json({ error: 'Facebook sign-in is not available on this host.' }, { status: 500 });

  const state = await createFacebookState(viewer.userId, companyId);
  return NextResponse.redirect(buildFacebookAuthUrl({ appId, redirectUri, state }));
}
