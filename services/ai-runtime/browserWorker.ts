/**
 * Optional Playwright browser worker for cost-aware escalate browsing.
 *
 * Env:
 * - NUCLEAS_BROWSER_WORKER_URL (this service's public HTTPS base, set on the Next app)
 * - NUCLEAS_BROWSER_WORKER_SECRET (shared bearer)
 * - PORT (default 8791)
 *
 * Run: npx tsx services/ai-runtime/browserWorker.ts
 * Requires: playwright (and browsers installed via `npx playwright install chromium`)
 */

import http from 'http';
import { pathToFileURL } from 'url';

const PORT = Number(process.env.PORT || 8791);
const SECRET = process.env.NUCLEAS_BROWSER_WORKER_SECRET?.trim() ?? '';

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

import { isSafePublicHttpsUrl } from '../../src/lib/ai/tools/ssrf';
import { contextIdentity, HIDE_AUTOMATION_SCRIPT, IGNORE_DEFAULT_ARGS, LAUNCH_ARGS } from './browserIdentity';
import { cancelLogin, finishLogin, loginFrame, loginInput, startLogin, type LoginInput } from './loginSessions';


async function navigate(url: string, maxChars: number) {
  // Dynamic load so the Next app typechecks without playwright installed in-tree.
  const playwright = (await import(
    /* webpackIgnore: true */ 'playwright' as string
  )) as {
    chromium: {
      launch: (opts: { headless: boolean }) => Promise<{
        newPage: () => Promise<{
          goto: (u: string, o: { waitUntil: string; timeout: number }) => Promise<unknown>;
          title: () => Promise<string>;
          evaluate: <T>(fn: (() => T) | string) => Promise<T>;
          url: () => string;
        }>;
        close: () => Promise<void>;
      }>;
    };
  };
  const browser = await playwright.chromium.launch({
    headless: true,
    // VPS / container-friendly; harmless for non-root service users too.
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  } as { headless: boolean });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();
    // Must be a string: tsx/esbuild injects __name into arrow functions, which breaks page.evaluate.
    const scraped = await page.evaluate(`(() => {
      const text = document.body?.innerText ?? '';
      const images = [];
      const push = (raw) => {
        const value = (raw ?? '').trim();
        if (!value || value.startsWith('data:')) return;
        try {
          const abs = new URL(value, location.href);
          if (abs.protocol !== 'https:') return;
          images.push(abs.toString());
        } catch {}
      };
      for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
        push(document.querySelector(sel)?.getAttribute('content'));
      }
      for (const img of Array.from(document.querySelectorAll('img[src]'))) {
        const w = img.naturalWidth || img.width || Number(img.getAttribute('width')) || 0;
        const h = img.naturalHeight || img.height || Number(img.getAttribute('height')) || 0;
        if ((w > 0 && w < 64) || (h > 0 && h < 64)) continue;
        push(img.currentSrc || img.src || img.getAttribute('src'));
      }
      return { text, images };
    })()`) as { text?: string; images?: string[] };
    const finalUrl = page.url();
    if (!isSafePublicHttpsUrl(finalUrl)) {
      throw new Error('Unsafe redirected URL.');
    }
    const seen = new Set<string>();
    const images: string[] = [];
    for (const src of scraped.images ?? []) {
      const key = src.toLowerCase();
      if (seen.has(key) || !isSafePublicHttpsUrl(src)) continue;
      seen.add(key);
      images.push(src.slice(0, 4000));
      if (images.length >= 12) break;
    }
    return {
      url: finalUrl,
      title: title.slice(0, 200),
      text: String(scraped.text ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars),
      images,
    };
  } finally {
    await browser.close();
  }
}


type Locator = {
  first: () => Locator;
  count: () => Promise<number>;
  isVisible: (o?: { timeout: number }) => Promise<boolean>;
};
type ObservePage = {
  goto: (u: string, o: { waitUntil: string; timeout: number }) => Promise<unknown>;
  title: () => Promise<string>;
  evaluate: <T>(fn: (() => T) | string) => Promise<T>;
  url: () => string;
  locator: (selector: string) => Locator;
  waitForLoadState: (state: string, o?: { timeout: number }) => Promise<void>;
};

export interface ObserveCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface ObserveInput {
  /** https origin of the site; the session is only ever used there. */
  baseUrl: string;
  url: string;
  /** The signed-in session, captured by a person logging in themselves. */
  cookies: ObserveCookie[];
  maxChars?: number;
}

export interface ObserveResult {
  url: string;
  title: string;
  loggedIn: boolean;
  text: string;
  note: string;
}

const PASSWORD_FIELD = 'input[type="password"]';

/**
 * Opens one page of a company's own site with a captured admin session and returns the page text.
 * Read-only by construction: every request that is not GET/HEAD/OPTIONS is aborted, and it never leaves the
 * site's origin. No password is involved; the cookies appear in no return value or log.
 */
export async function observeAuthenticated(input: ObserveInput, options: { allowInsecure?: boolean; executablePath?: string } = {}): Promise<ObserveResult> {
  const origin = new URL(input.baseUrl);
  const target = new URL(input.url);
  if (target.origin !== origin.origin) throw new Error('The page is outside the account\u2019s site.');
  if (!options.allowInsecure && (!isSafePublicHttpsUrl(origin.toString()) || !isSafePublicHttpsUrl(target.toString()))) throw new Error('Unsafe URL');
  const host = origin.hostname.toLowerCase();
  const cookies = (Array.isArray(input.cookies) ? input.cookies : [])
    .filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string')
    .filter((c) => {
      const d = c.domain.replace(/^\./, '').toLowerCase();
      return host === d || host.endsWith(`.${d}`);
    })
    .slice(0, 60);
  const playwright = (await import(/* webpackIgnore: true */ 'playwright' as string)) as {
    chromium: {
      launch: (opts: Record<string, unknown>) => Promise<{
        version: () => string;
        newContext: (o: Record<string, unknown>) => Promise<{
          newPage: () => Promise<ObservePage>;
          addInitScript: (script: string) => Promise<void>;
          addCookies: (cookies: unknown[]) => Promise<void>;
          route: (glob: string, handler: (route: { request: () => { method: () => string }; abort: () => Promise<void>; continue: () => Promise<void> }) => Promise<void>) => Promise<void>;
        }>;
        close: () => Promise<void>;
      }>;
    };
  };
  const browser = await playwright.chromium.launch({
    headless: true,
    args: LAUNCH_ARGS,
    ignoreDefaultArgs: IGNORE_DEFAULT_ARGS,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  try {
    const context = await browser.newContext(contextIdentity(browser.version()));
    await context.addInitScript(HIDE_AUTOMATION_SCRIPT);
    // Nothing can be changed: only reads go out, including from scripts on the page.
    await context.route('**/*', async (route) => {
      const method = route.request().method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
      return route.abort();
    });
    await context.addCookies(cookies.map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
      ...(typeof c.expires === 'number' && c.expires > 0 ? { expires: c.expires } : {}),
      httpOnly: c.httpOnly === true,
      secure: options.allowInsecure ? false : c.secure !== false,
      sameSite: c.sameSite ?? 'Lax',
    })));
    const page = await context.newPage();
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    // A login form means the session is not (or no longer) signed in.
    const login = page.locator(PASSWORD_FIELD).first();
    const signedOut = (await login.count()) > 0 && (await login.isVisible({ timeout: 1500 }).catch(() => false));
    const finalUrl = page.url();
    if (new URL(finalUrl).origin !== origin.origin) throw new Error('Redirected outside the site.');
    const title = await page.title();
    const raw = signedOut ? '' : await page.evaluate('document.body ? document.body.innerText : ""');
    return {
      url: finalUrl,
      title: title.slice(0, 200),
      loggedIn: !signedOut,
      note: signedOut ? 'The session is no longer signed in (the login form is showing).' : 'Opened with the captured admin session.',
      text: String(raw ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, Math.min(Math.max(Number(input.maxChars) || 20000, 1000), 40000)),
    };
  } finally {
    await browser.close();
  }
}

export function startBrowserWorkerServer() {
  if (SECRET.length < 16) {
    throw new Error('NUCLEAS_BROWSER_WORKER_SECRET must be at least 16 characters.');
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method !== 'POST' || !['/navigate', '/observe', '/login/start', '/login/frame', '/login/input', '/login/finish', '/login/cancel'].includes(req.url ?? '')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${SECRET}`) {
        res.writeHead(401);
        res.end();
        return;
      }
      if (req.url?.startsWith('/login/')) {
        try {
        const b = JSON.parse(await readBody(req, 16_000)) as { baseUrl?: string; sessionId?: string; input?: LoginInput };
        const send = (payload: unknown) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (req.url === '/login/start') {
          if (typeof b.baseUrl !== 'string') throw new Error('baseUrl is required');
          return send(await startLogin({ baseUrl: b.baseUrl }));
        }
        if (typeof b.sessionId !== 'string') throw new Error('sessionId is required');
        if (req.url === '/login/frame') return send(await loginFrame(b.sessionId));
        if (req.url === '/login/input') { await loginInput(b.sessionId, b.input as LoginInput); return send({ ok: true }); }
        if (req.url === '/login/finish') return send(await finishLogin(b.sessionId));
        await cancelLogin(b.sessionId);
        return send({ ok: true });
        } catch (error) {
          // These messages are ours (timeouts, bad input); they carry no cookies or page content.
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 200) : 'Login failed' }));
          return;
        }
      }
      if (req.url === '/observe') {
        const b = JSON.parse(await readBody(req, 64_000)) as Partial<ObserveInput>;
        if (typeof b.baseUrl !== 'string' || typeof b.url !== 'string' || !Array.isArray(b.cookies)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
          return;
        }
        const result = await observeAuthenticated({ baseUrl: b.baseUrl, url: b.url, cookies: b.cookies, maxChars: b.maxChars });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      const raw = await readBody(req, 16_000);
      const body = JSON.parse(raw) as { url?: string; maxChars?: number };
      const url = typeof body.url === 'string' ? body.url : '';
      if (!isSafePublicHttpsUrl(url)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unsafe URL' }));
        return;
      }
      const maxChars = Math.min(Math.max(Number(body.maxChars) || 12000, 1000), 20000);
      const result = await navigate(url, maxChars);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      // Never log the request body: /observe and /login carry session cookies.
      console.error('browser worker error', err instanceof Error ? err.message : 'unknown');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'navigate_failed' }));
    }
  });

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`browserWorker listening on ${PORT}`);
  });
  return server;
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  startBrowserWorkerServer();
}
