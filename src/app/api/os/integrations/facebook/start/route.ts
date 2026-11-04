import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { connectionReturnPath } from '@/lib/auth/connectionReturn';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { buildFacebookAuthUrl, createFacebookState, facebookRedirectUri } from '@/lib/integrations/facebook/facebookOAuth';

/** Starts Facebook login for one company's Page. Managers only. */
export async function GET(request: NextRequest) {
  if (!await getSession()) {
    const returnTo = connectionReturnPath(request.nextUrl.pathname + request.nextUrl.search);
    if (!returnTo) return NextResponse.json({ error: 'Invalid company connection request.' }, { status: 400 });
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set('connection-login-return', returnTo, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
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
