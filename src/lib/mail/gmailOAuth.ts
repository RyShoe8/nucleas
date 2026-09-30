import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';

/**
 * Gmail access: read, label and archive (gmail.modify, a RESTRICTED scope) and send (gmail.send, a sensitive
 * scope). Any scope that can read message bodies is restricted, so there is no lighter way to read mail through
 * the Gmail API. For your own and your clients' mailboxes the app can stay unverified (see docs/MAIL.md).
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

export const GMAIL_CALLBACK_PATH = '/api/os/mail/google/callback';

/** Hosts allowed to receive the OAuth callback. Must also be registered on the Google OAuth client. */
const ALLOWED_CALLBACK_HOSTS = ['os.nucleas.app', 'nucleas.app', 'os.localhost:3000', 'localhost:3000'];

export function gmailRedirectUri(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (!ALLOWED_CALLBACK_HOSTS.includes(url.host)) return null;
  const protocol = url.hostname.endsWith('localhost') ? 'http:' : 'https:';
  return `${protocol}//${url.host}${GMAIL_CALLBACK_PATH}`;
}

type StatePayload = { userId: string; companyId: string | null; purpose: 'mail-google'; nonce: string };

function stateKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required');
  return new TextEncoder().encode(`mail-google:${secret}`);
}

/** The state carries who is connecting and which company (if any) the mailbox should be filed under. */
export async function createGmailState(userId: string, companyId: string | null): Promise<string> {
  return new SignJWT({ userId, companyId, purpose: 'mail-google', nonce: randomUUID() } satisfies StatePayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(stateKey());
}

export async function verifyGmailState(token: string): Promise<StatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, stateKey());
    if (payload.purpose !== 'mail-google' || typeof payload.userId !== 'string') return null;
    return { userId: payload.userId, companyId: typeof payload.companyId === 'string' ? payload.companyId : null, purpose: 'mail-google', nonce: String(payload.nonce ?? '') };
  } catch {
    return null;
  }
}

export function buildGmailAuthUrl(options: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  // Always re-consent so Google returns a refresh token even if previously granted; always let the person pick the account.
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('state', options.state);
  if (options.loginHint) url.searchParams.set('login_hint', options.loginHint);
  return url.toString();
}
