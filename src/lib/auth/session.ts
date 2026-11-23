import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

const secretKey = process.env.NEXTAUTH_SECRET;
if (!secretKey) {
  throw new Error('NEXTAUTH_SECRET environment variable is required');
}
const key = new TextEncoder().encode(secretKey);

export interface SessionPayload {
  userId: string;
  email: string;
  expiresAt: Date;
  [key: string]: unknown;
}

async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

async function decrypt(session: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(session, key);
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get('session')?.value;
  if (!session) return null;
  return decrypt(session);
}

export async function createSession(userId: string, email: string, desktopSessionId?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const session = await encrypt({ userId, email, expiresAt, ...(desktopSessionId ? { desktopSessionId } : {}) });

  const cookieStore = await cookies();
  cookieStore.set('session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  });
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const value = cookieStore.get('session')?.value;
  const session = value ? await decrypt(value) : null;
  if (typeof session?.desktopSessionId === 'string') {
    const { revokeDesktopSession } = await import('./desktopSession');
    await revokeDesktopSession(session.desktopSessionId, session.userId);
  }
  cookieStore.set('nucleas-desktop-refresh', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth/desktop', maxAge: 0 });
  cookieStore.delete('session');
}
