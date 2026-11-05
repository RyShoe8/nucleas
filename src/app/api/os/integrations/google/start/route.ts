import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { connectionReturnPath } from '@/lib/auth/connectionReturn';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import {
  buildGoogleIntegrationAuthUrl,
  createGoogleIntegrationState,
  googleIntegrationRedirectUri,
} from '@/lib/integrations/google/googleOAuth';

/** Starts Google sign-in for Analytics + Search Console. Managers only. */
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

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = googleIntegrationRedirectUri(request.url);
  if (!clientId || !redirectUri) return NextResponse.json({ error: 'Google sign-in is not available on this host.' }, { status: 500 });

  const state = await createGoogleIntegrationState(viewer.userId, companyId, /^[a-f0-9]{32}$/.test(request.nextUrl.searchParams.get("desktopFlow") ?? "") ? request.nextUrl.searchParams.get("desktopFlow")! : undefined);
  return NextResponse.redirect(buildGoogleIntegrationAuthUrl({ clientId, redirectUri, state, adManager: request.nextUrl.searchParams.get("provider") === "admanager" }));
}
