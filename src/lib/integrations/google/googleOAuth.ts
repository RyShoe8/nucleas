import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';

/** Read-only scopes for company analytics + search data. `email` identifies which Google account was used. */
export const GOOGLE_INTEGRATION_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/adsense.readonly',
  'email',
] as const;

export const GOOGLE_INTEGRATION_CALLBACK_PATH = '/api/os/integrations/google/callback';

/** Hosts allowed to receive the OAuth callback. Must also be registered on the Google OAuth client. */
const ALLOWED_CALLBACK_HOSTS = ['os.nucleas.app', 'nucleas.app', 'os.localhost:3000', 'localhost:3000'];

export function googleIntegrationRedirectUri(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (!ALLOWED_CALLBACK_HOSTS.includes(url.host)) return null;
  const protocol = url.hostname.endsWith('localhost') ? 'http:' : 'https:';
  return `${protocol}//${url.host}${GOOGLE_INTEGRATION_CALLBACK_PATH}`;
}

type StatePayload = { userId: string; companyId: string; purpose: 'integration-google'; nonce: string };

function stateKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required');
  return new TextEncoder().encode(`integration-google:${secret}`);
}

export async function createGoogleIntegrationState(userId: string, companyId: string): Promise<string> {
  return new SignJWT({ userId, companyId, purpose: 'integration-google', nonce: randomUUID() } satisfies StatePayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(stateKey());
}

export async function verifyGoogleIntegrationState(token: string): Promise<StatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, stateKey());
    if (payload.purpose !== 'integration-google') return null;
    if (typeof payload.userId !== 'string' || typeof payload.companyId !== 'string') return null;
    return payload as unknown as StatePayload;
  } catch {
    return null;
  }
}

export function buildGoogleIntegrationAuthUrl(options: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_INTEGRATION_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  // Always re-consent so Google returns a refresh token even if previously granted.
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', options.state);
  return url.toString();
}
