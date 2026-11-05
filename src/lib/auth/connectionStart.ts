import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { connectionReturnPath } from '@/lib/auth/connectionReturn';

/**
 * Account connections open in the system browser (from the desktop app or a reconnect email), which may be signed
 * out. Without a valid session this sends the person to sign in and resumes the connection afterwards; with one it
 * returns null and the route carries on. The route must be exempt from the session check in middleware.
 */
export async function loginFirstForConnection(request: NextRequest): Promise<NextResponse | null> {
  if (await getSession()) return null;
  const returnTo = connectionReturnPath(request.nextUrl.pathname + request.nextUrl.search);
  if (!returnTo) return NextResponse.json({ error: 'Invalid connection request.' }, { status: 400 });
  const response = NextResponse.redirect(new URL('/login', request.url));
  response.cookies.set('connection-login-return', returnTo, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
