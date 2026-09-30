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
  fill: (value: string, o?: { timeout: number }) => Promise<void>;
  click: (o?: { timeout: number }) => Promise<void>;
  press: (key: string, o?: { timeout: number }) => Promise<void>;
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

export interface ObserveInput {
  /** https origin of the site; the account is only ever used there. */
  baseUrl: string;
  url: string;
  username: string;
  password: string;
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
const USER_FIELDS = 'input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i], input[type="text"]';

/**
 * Opens one page of a company's own site with its test account and returns the page text. Read-only by
 * construction: it logs in once, then aborts every request that is not GET/HEAD, and it never leaves the
 * site's origin. The password is used to fill the form and appears in no return value or log.
 */
export async function observeAuthenticated(input: ObserveInput, options: { allowInsecure?: boolean; executablePath?: string } = {}): Promise<ObserveResult> {
  const origin = new URL(input.baseUrl);
  const target = new URL(input.url);
  if (target.origin !== origin.origin) throw new Error('The page is outside the account\u2019s site.');
  if (!options.allowInsecure && (!isSafePublicHttpsUrl(origin.toString()) || !isSafePublicHttpsUrl(target.toString()))) throw new Error('Unsafe URL');
  const playwright = (await import(/* webpackIgnore: true */ 'playwright' as string)) as {
    chromium: {
      launch: (opts: Record<string, unknown>) => Promise<{
        newContext: () => Promise<{
          newPage: () => Promise<ObservePage>;
          route: (glob: string, handler: (route: { request: () => { method: () => string; isNavigationRequest: () => boolean; url: () => string }; abort: () => Promise<void>; continue: () => Promise<void> }) => Promise<void>) => Promise<void>;
        }>;
        close: () => Promise<void>;
      }>;
    };
  };
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  try {
    const context = await browser.newContext();
    // Nothing can be changed: only reads go out. The one exception is the login form's own submission
    // (a top-level navigation, once); scripts on the page cannot send writes even while logging in.
    let loginSubmit = false;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const method = request.method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
      if (loginSubmit && request.isNavigationRequest()) {
        loginSubmit = false;
        return route.continue();
      }
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    let loggedIn = true;
    let note = 'Opened without logging in.';
    const password = page.locator(PASSWORD_FIELD).first();
    if ((await password.count()) > 0 && (await password.isVisible({ timeout: 3000 }).catch(() => false))) {
      note = 'Logged in with the test account.';
      const user = page.locator(USER_FIELDS).first();
      if ((await user.count()) > 0) await user.fill(input.username, { timeout: 5000 });
      await password.fill(input.password, { timeout: 5000 });
      const submit = page.locator('form:has(input[type="password"]) button[type="submit"], form:has(input[type="password"]) input[type="submit"]').first();
      loginSubmit = true;
      if ((await submit.count()) > 0) await submit.click({ timeout: 5000 });
      else await password.press('Enter', { timeout: 5000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
      if (new URL(page.url()).pathname !== target.pathname) await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
      const stillLogin = page.locator(PASSWORD_FIELD).first();
      if ((await stillLogin.count()) > 0 && (await stillLogin.isVisible({ timeout: 1000 }).catch(() => false))) {
        loggedIn = false;
        note = 'The login form is still showing: the test account was not accepted.';
      }
    }
    const finalUrl = page.url();
    if (new URL(finalUrl).origin !== origin.origin) throw new Error('Redirected outside the site.');
    const title = await page.title();
    const raw = await page.evaluate('document.body ? document.body.innerText : ""');
    return {
      url: finalUrl,
      title: title.slice(0, 200),
      loggedIn,
      note,
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
      if (req.method !== 'POST' || (req.url !== '/navigate' && req.url !== '/observe')) {
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
      if (req.url === '/observe') {
        const b = JSON.parse(await readBody(req, 16_000)) as Partial<ObserveInput>;
        if (typeof b.baseUrl !== 'string' || typeof b.url !== 'string' || typeof b.username !== 'string' || typeof b.password !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
          return;
        }
        const result = await observeAuthenticated({ baseUrl: b.baseUrl, url: b.url, username: b.username, password: b.password, maxChars: b.maxChars });
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
      // Never log the request body: /observe carries a password.
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
