import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { loginFirstForConnection } from '@/lib/auth/connectionStart';
import {
  getCalendarOAuthRedirectUri,
  getCalendarOAuthScopes,
} from '@/lib/scheduling/googleCalendar';
import { createCalendarOAuthState } from '@/lib/scheduling/oauthState';

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

    const redirectUri = getCalendarOAuthRedirectUri(new URL(request.url).origin);

    const state = await createCalendarOAuthState(session.userId);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', getCalendarOAuthScopes());
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    console.error('Calendar connect error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
