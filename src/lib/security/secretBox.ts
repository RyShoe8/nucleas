import 'server-only';
import crypto from 'crypto';

/**
 * Purpose-scoped AES-256-GCM encryption for provider credentials.
 *
 * Each purpose ('integration:brevo', 'browser-session:ahrefs', ...) derives its own key via
 * HKDF, so a ciphertext cannot be decrypted under another purpose. Output is prefixed with a
 * key version for rotation. Existing modelSecrets/tokenCrypto ciphertexts are unaffected.
 */

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * Master secret: an optional dedicated key, else the app secret already present in every
 * environment (same precedent as modelSecrets). HKDF with a Nucleas-specific salt/info keeps the
 * derived keys independent of session signing. Rotating the master secret requires reconnecting
 * integrations (their stored credentials become unreadable and report needs_reauth).
 */
function masterSecret(): string {
  const secret =
    process.env.NUCLEAS_SECRETS_KEY?.trim() || process.env.AI_MODEL_SECRETS_KEY?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error('No master secret available to store integration credentials.');
  return secret;
}

function keyFor(purpose: string): Buffer {
  if (!purpose) throw new Error('secretBox purpose is required');
  return Buffer.from(crypto.hkdfSync('sha256', masterSecret(), 'nucleas-secret-box', `${VERSION}:${purpose}`, 32));
}

export function sealSecret(purpose: string, plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, keyFor(purpose), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url')}`;
}

export function openSecret(purpose: string, sealed: string): string {
  const [version, body] = sealed.split('.', 2);
  if (version !== VERSION || !body) throw new Error('Unsupported secret format');
  const buf = Buffer.from(body, 'base64url');
  const decipher = crypto.createDecipheriv(ALGO, keyFor(purpose), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/** Safe display hint, e.g. "…a1b2". Never returns more than the last 4 characters. */
export function secretHint(plain: string): string {
  const trimmed = plain.trim();
  return trimmed.length > 8 ? `…${trimmed.slice(-4)}` : '…';
}
