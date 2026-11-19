import { NextRequest, NextResponse } from 'next/server';
import { createLoginOAuthState } from '@/lib/auth/loginOauthState';

/**
 * Initiate Google OAuth flow
 */
export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    
    if (!clientId) {
      return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
    }

    // Construct redirect URI from request URL to ensure it uses the correct domain
    const baseUrl = new URL(request.url).origin;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;

    // Get invitation token from query params if present
    const searchParams = request.nextUrl.searchParams;
    const invitationToken = searchParams.get('invitation');

    // Signed state token (CSRF protection); carries the invitation token if present
    const state = await createLoginOAuthState(invitationToken ?? undefined);

    // Google OAuth authorization URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    return NextResponse.redirect(authUrl.toString());
  } catch {
    // Google OAuth initiation error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
