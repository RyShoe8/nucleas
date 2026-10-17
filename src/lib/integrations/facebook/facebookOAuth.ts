import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';
import { ALLOWED_CALLBACK_HOSTS } from '@/lib/integrations/google/googleOAuth';

export const FACEBOOK_GRAPH = 'https://graph.facebook.com/v21.0';
export const FACEBOOK_CALLBACK_PATH = '/api/os/integrations/facebook/callback';
/** The person picks which Pages to share in Facebook's own dialog. pages_manage_posts lets publishing jobs post to those Pages. */
export const FACEBOOK_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'] as const;

export function facebookSignInConfigured(): boolean {
  return Boolean(process.env.FACEBOOK_APP_ID?.trim() && process.env.FACEBOOK_APP_SECRET?.trim());
}

export function facebookRedirectUri(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (!ALLOWED_CALLBACK_HOSTS.includes(url.host)) return null;
  const protocol = url.hostname.endsWith('localhost') ? 'http:' : 'https:';
  return `${protocol}//${url.host}${FACEBOOK_CALLBACK_PATH}`;
}

type StatePayload = { userId: string; companyId: string; purpose: 'integration-facebook'; nonce: string };

function stateKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required');
  return new TextEncoder().encode(`integration-facebook:${secret}`);
}

export async function createFacebookState(userId: string, companyId: string): Promise<string> {
  return new SignJWT({ userId, companyId, purpose: 'integration-facebook', nonce: randomUUID() } satisfies StatePayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(stateKey());
}

export async function verifyFacebookState(token: string): Promise<StatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, stateKey());
    if (payload.purpose !== 'integration-facebook') return null;
    if (typeof payload.userId !== 'string' || typeof payload.companyId !== 'string') return null;
    return payload as unknown as StatePayload;
  } catch {
    return null;
  }
}

export function buildFacebookAuthUrl(options: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  url.searchParams.set('client_id', options.appId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', FACEBOOK_SCOPES.join(','));
  url.searchParams.set('state', options.state);
  return url.toString();
}
