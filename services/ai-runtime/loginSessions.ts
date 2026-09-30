/**
 * Interactive login through the browser worker: a person logs in to their own site in a real browser that
 * runs here, seen and driven from the Nucleas UI (screenshots out, clicks and keys in). When they say they
 * are done, only the site's cookies are handed back. No password ever passes through Nucleas as data we keep:
 * it is typed into the site's own form, in the browser.
 */
import crypto from 'crypto';
import { isSafePublicHttpsUrl } from '../../src/lib/ai/tools/ssrf';

export const VIEWPORT = { width: 1000, height: 640 };
const MAX_SESSIONS = 2;
const TTL_MS = 10 * 60_000;

type Page = {
  goto: (u: string, o: { waitUntil: string; timeout: number }) => Promise<unknown>;
  screenshot: (o: { type: 'jpeg'; quality: number }) => Promise<Buffer>;
  title: () => Promise<string>;
  url: () => string;
  mouse: { click: (x: number, y: number) => Promise<void>; wheel: (dx: number, dy: number) => Promise<void> };
  keyboard: { type: (text: string) => Promise<void>; press: (key: string) => Promise<void> };
};
type Context = {
  newPage: () => Promise<Page>;
  cookies: () => Promise<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }[]>;
  route: (glob: string, handler: (route: { request: () => { url: () => string }; abort: () => Promise<void>; continue: () => Promise<void> }) => Promise<void>) => Promise<void>;
};
type Browser = { newContext: (o: { viewport: { width: number; height: number } }) => Promise<Context>; close: () => Promise<void> };

interface Session {
  id: string;
  host: string;
  browser: Browser;
  page: Page;
  context: Context;
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Session>();

export interface LoginOptions {
  /** Tests only: allow a local http site. */
  allowInsecure?: boolean;
  executablePath?: string;
}

async function close(session: Session) {
  clearTimeout(session.timer);
  sessions.delete(session.id);
  await session.browser.close().catch(() => undefined);
}

export async function startLogin(input: { baseUrl: string }, options: LoginOptions = {}): Promise<{ sessionId: string; width: number; height: number }> {
  const base = new URL(input.baseUrl);
  if (!options.allowInsecure && !isSafePublicHttpsUrl(base.toString())) throw new Error('Unsafe URL');
  if (sessions.size >= MAX_SESSIONS) throw new Error('Too many logins are open right now. Try again in a minute.');
  const playwright = (await import(/* webpackIgnore: true */ 'playwright' as string)) as {
    chromium: { launch: (o: Record<string, unknown>) => Promise<Browser> };
  };
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    // Logins often bounce through an identity provider, so other public https sites are allowed; private hosts are not.
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (options.allowInsecure || isSafePublicHttpsUrl(url) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    const id = crypto.randomBytes(12).toString('hex');
    const session: Session = { id, host: base.hostname.toLowerCase(), browser, page, context, timer: setTimeout(() => void close(session), TTL_MS) };
    sessions.set(id, session);
    return { sessionId: id, ...VIEWPORT };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

function get(id: string): Session {
  const session = sessions.get(id);
  if (!session) throw new Error('The login window timed out. Start again.');
  return session;
}

export async function loginFrame(id: string): Promise<{ image: string; url: string; title: string }> {
  const s = get(id);
  const image = await s.page.screenshot({ type: 'jpeg', quality: 60 });
  return { image: image.toString('base64'), url: s.page.url(), title: (await s.page.title().catch(() => '')).slice(0, 200) };
}

export type LoginInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; deltaY: number };

const KEYS = new Set(['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Control+a', 'Meta+a']);

export async function loginInput(id: string, input: LoginInput): Promise<void> {
  const s = get(id);
  if (input.type === 'click') {
    const x = Math.min(Math.max(Number(input.x) || 0, 0), VIEWPORT.width);
    const y = Math.min(Math.max(Number(input.y) || 0, 0), VIEWPORT.height);
    await s.page.mouse.click(x, y);
  } else if (input.type === 'text') {
    await s.page.keyboard.type(String(input.text).slice(0, 500));
  } else if (input.type === 'key') {
    if (!KEYS.has(input.key)) throw new Error('Unsupported key.');
    await s.page.keyboard.press(input.key);
  } else if (input.type === 'scroll') {
    await s.page.mouse.wheel(0, Math.min(Math.max(Number(input.deltaY) || 0, -2000), 2000));
  }
}

/** The site's own cookies from the logged-in browser; the window is closed. */
export async function finishLogin(id: string): Promise<{ cookies: Awaited<ReturnType<Context['cookies']>>; url: string }> {
  const s = get(id);
  try {
    const all = await s.context.cookies();
    const cookies = all.filter((c) => {
      const d = c.domain.replace(/^\./, '').toLowerCase();
      return s.host === d || s.host.endsWith(`.${d}`);
    });
    return { cookies, url: s.page.url() };
  } finally {
    await close(s);
  }
}

export async function cancelLogin(id: string): Promise<void> {
  const s = sessions.get(id);
  if (s) await close(s);
}
