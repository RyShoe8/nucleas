import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { loginFirstForConnection } from '@/lib/auth/connectionStart';
import { getDriveOAuthRedirectUri } from '@/lib/google/driveConnection';
import { DRIVE_FILE_SCOPE } from '@/lib/google/oauth';
import { createDriveOAuthState } from '@/lib/google/oauthState';

function sanitizeReturnTo(raw: string | null, origin: string): string {
  if (!raw) return `${origin}/workspace`;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return `${origin}/workspace`;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return `${origin}/workspace`;
  }
}

export async function GET(request: NextRequest) {
  try {
    const login = await loginFirstForConnection(request);
    if (login) return login;
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const redirectUri = getDriveOAuthRedirectUri(origin);
    const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'), origin);
    const state = await createDriveOAuthState(session.userId, returnTo);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', DRIVE_FILE_SCOPE);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    console.error('Google workspace connect error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
