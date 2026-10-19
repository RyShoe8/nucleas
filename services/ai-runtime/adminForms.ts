import { isReadOnlyFormLookup } from './adminLookups';
/**
 * Reading and filling a form in a company's own admin, with the admin session a person captured by
 * logging in themselves. Used by publishing jobs that add records (a deal, an event) to the company's site.
 *
 * inspect: read-only: GET/HEAD/OPTIONS and narrowly validated choice lookups only.
 * fill:    fills the form and takes a screenshot. Without `submit` it stays read-only (a dry run). With
 *          `submit`, writes are allowed to the site's own origin only; other hosts stay read-only.
 * Cookies never appear in a return value or a log.
 */

import { isSafePublicHttpsUrl } from '../../src/lib/ai/tools/ssrf';
import { contextIdentity, HIDE_AUTOMATION_SCRIPT, IGNORE_DEFAULT_ARGS, LAUNCH_ARGS, withSiteHeader } from './browserIdentity';

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'datetime-local' | 'time' | 'url' | 'email' | 'tel' | 'select' | 'checkbox' | 'radio' | 'richtext' | 'file';

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  selector: string;
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface FormSnapshot {
  url: string;
  title: string;
  loggedIn: boolean;
  fields: FormField[];
  submit: { selector: string; label: string } | null;
  links: { text: string; href: string }[];
  headings: string[];
}

export interface FillResult {
  url: string;
  title: string;
  loggedIn: boolean;
  submitted: boolean;
  /** Field keys whose control was not on the page (the form changed). */
  missing: string[];
  /** Messages the form showed (browser validation or the site's own errors). */
  errors: string[];
  /** The page text after submitting, to judge success. */
  text: string;
  /** JPEG, base64. */
  screenshot: string | null;
}

export interface AdminSession {
  baseUrl: string;
  url: string;
  cookies: { name: string; value: string; domain: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' }[];
}

type Locator = {
  first: () => Locator;
  waitFor: (options: { state: 'visible'; timeout: number }) => Promise<void>;
  locator: (selector: string) => Locator;
  getByRole: (role: string, options: { name: string; exact: boolean }) => Locator;
  count: () => Promise<number>;
  isVisible: (o?: { timeout: number }) => Promise<boolean>;
  focus: (options?: { timeout: number }) => Promise<void>;
  fill: (value: string, o?: { timeout: number }) => Promise<void>;
  selectOption: (value: { value?: string; label?: string }, o?: { timeout: number }) => Promise<unknown>;
  setChecked: (checked: boolean, o?: { timeout: number }) => Promise<void>;
  check: (o?: { timeout: number }) => Promise<void>;
  click: (o?: { timeout: number }) => Promise<void>;
};
type Page = {
  goto: (u: string, o: { waitUntil: string; timeout: number }) => Promise<unknown>;
  title: () => Promise<string>;
  evaluate: <T>(fn: string) => Promise<T>;
  url: () => string;
  locator: (selector: string) => Locator;
  waitForLoadState: (state: string, o?: { timeout: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  screenshot: (o: Record<string, unknown>) => Promise<Buffer>;
  on: (event: 'dialog', handler: (dialog: { accept: () => Promise<void>; dismiss: () => Promise<void> }) => void) => void;
};
type Route = { request: () => { postDataJSON: () => unknown; method: () => string; url: () => string; headers: () => Record<string, string> }; abort: () => Promise<void>; continue: (o?: { headers: Record<string, string> }) => Promise<void> };

interface Options {
  allowInsecure?: boolean;
  executablePath?: string;
}

/** Opens the page with the session. `writesToSite` lets non-GET requests reach the site's own origin only. */
async function openPage<T>(input: AdminSession, options: Options, writesToSite: boolean, work: (page: Page, origin: URL) => Promise<T>): Promise<T> {
  const origin = new URL(input.baseUrl);
  const target = new URL(input.url);
  if (target.origin !== origin.origin) throw new Error('The page is outside the account’s site.');
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
          newPage: () => Promise<Page>;
          addInitScript: (script: string) => Promise<void>;
          addCookies: (cookies: unknown[]) => Promise<void>;
          route: (glob: string, handler: (route: Route) => Promise<void>) => Promise<void>;
        }>;
        close: () => Promise<void>;
      }>;
    };
  };
  const browser = await playwright.chromium.launch({ headless: true, args: LAUNCH_ARGS, ignoreDefaultArgs: IGNORE_DEFAULT_ARGS, ...(options.executablePath ? { executablePath: options.executablePath } : {}) });
  try {
    const context = await browser.newContext({ ...contextIdentity(browser.version()), viewport: { width: 1280, height: 900 } });
    await context.addInitScript(HIDE_AUTOMATION_SCRIPT);
    await context.route('**/*', async (route) => {
      const request = route.request();
      const method = request.method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue(withSiteHeader(request, host));
      let sameOrigin = false;
      try {
        sameOrigin = new URL(request.url()).origin === origin.origin;
      } catch {
        sameOrigin = false;
      }
      if (writesToSite && sameOrigin) return route.continue(withSiteHeader(request, host));
      if (sameOrigin && method === 'POST' && /\/livewire(?:-[a-z0-9]+)?\/update$/.test(new URL(request.url()).pathname)) {
        try { if (isReadOnlyFormLookup(request.postDataJSON())) return route.continue(withSiteHeader(request, host)); } catch { /* Invalid bodies remain blocked. */ }
      }
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
    // A confirm() before saving is the site asking "are you sure?": yes only when saving was asked for.
    page.on('dialog', (dialog) => void (writesToSite ? dialog.accept() : dialog.dismiss()).catch(() => undefined));
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    if (await page.locator('.fi-select-input').count()) await page.locator('.fi-select-input-btn').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
    if (new URL(page.url()).origin !== origin.origin) throw new Error('Redirected outside the site.');
    return await work(page, origin);
  } finally {
    await browser.close();
  }
}

async function signedOut(page: Page): Promise<boolean> {
  const login = page.locator('input[type="password"]').first();
  return (await login.count()) > 0 && (await login.isVisible({ timeout: 1500 }).catch(() => false));
}

/**
 * Runs in the page (as a string: tsx/esbuild would inject helpers into a function). Finds the main form
 * (the one with the most fillable controls, or the page itself for forms without a <form> element) and
 * describes each control with a stable selector and the label a person sees.
 */
const INSPECT_SCRIPT = `(() => {
  const clean = (t) => String(t || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const SKIP = ['hidden', 'submit', 'button', 'reset', 'image', 'search', 'password'];
  const controlsIn = (root) => Array.from(root.querySelectorAll('input, select, textarea, [contenteditable="true"], [contenteditable=""]')).filter((el) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (SKIP.includes(type)) return false;
    if (el.closest('[contenteditable="true"]') && el.closest('[contenteditable="true"]') !== el) return false;
    return visible(el) || type === 'file' || type === 'radio' || type === 'checkbox';
  });
  const forms = Array.from(document.querySelectorAll('form')).filter((f) => !f.querySelector('input[type="password"]'));
  let root = forms.sort((a, b) => controlsIn(b).length - controlsIn(a).length)[0];
  if (!root || controlsIn(root).length === 0) root = document.querySelector('main') || document.body;
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const pathOf = (el) => {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body) {
      let i = 1; let s = n;
      while ((s = s.previousElementSibling)) if (s.tagName === n.tagName) i += 1;
      parts.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      n = n.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  };
  const selectorFor = (el) => {
    if (el.id && unique('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    const name = el.getAttribute('name');
    if (name) { const s = el.tagName.toLowerCase() + '[name="' + name.replace(/"/g, '\\\\"') + '"]'; if (unique(s)) return s; }
    return pathOf(el);
  };
  const labelFor = (el) => {
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && clean(l.innerText)) return clean(l.innerText); }
    const wrap = el.closest('label'); if (wrap && clean(wrap.innerText)) return clean(wrap.innerText);
    const aria = el.getAttribute('aria-label'); if (aria) return clean(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\\s+/).map((id) => (document.getElementById(id) || {}).innerText || '').join(' '); if (clean(t)) return clean(t); }
    let node = el;
    for (let depth = 0; depth < 3 && node; depth += 1) {
      let prev = node.previousElementSibling;
      while (prev) { const t = clean(prev.innerText); if (t && t.length <= 80) return t; prev = prev.previousElementSibling; }
      node = node.parentElement;
    }
    return clean(el.getAttribute('placeholder') || el.getAttribute('name') || el.id || '');
  };
  const typeOf = (el) => {
    if (el.isContentEditable) return 'richtext';
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    return ['number', 'date', 'datetime-local', 'time', 'url', 'email', 'tel', 'checkbox', 'radio', 'file'].includes(t) ? t : 'text';
  };
  const keys = new Set();
  const keyFor = (label) => {
    const base = (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36)) || 'field';
    let key = base; let i = 2;
    while (keys.has(key)) key = base + '_' + i++;
    keys.add(key);
    return key;
  };
  const fields = [];
  const radios = new Map();
  for (const el of controlsIn(root)) {
    const type = typeOf(el);
    const required = el.required === true || el.getAttribute('aria-required') === 'true';
    if (type === 'radio') {
      const name = el.getAttribute('name') || selectorFor(el);
      const group = radios.get(name) || { label: '', options: [], required: false };
      if (!group.label) { const fs = el.closest('fieldset'); const legend = fs && fs.querySelector('legend'); group.label = clean(legend ? legend.innerText : '') || clean(name); }
      group.options.push({ value: el.value, label: labelFor(el) });
      group.required = group.required || required;
      radios.set(name, group);
      continue;
    }
    const label = labelFor(el);
    const field = { key: keyFor(label.replace(/\\*$/, '')), label: label.replace(/\\s*\\*$/, ''), type, selector: selectorFor(el), required: required || /\\*\\s*$/.test(label) };
    if (type === 'select') field.options = Array.from(el.options).filter((o) => !o.disabled).map((o) => ({ value: o.value, label: clean(o.text) })).slice(0, 200);
    const ph = el.getAttribute('placeholder'); if (ph) field.placeholder = clean(ph);
    fields.push(field);
  }
  // Filament's searchable selects are buttons/listboxes, not native <select>s.
  for (const widget of root.querySelectorAll('.fi-select-input')) {
    const wrapper = widget.closest('.fi-fo-field');
    const labelEl = wrapper && wrapper.querySelector('label');
    if (!labelEl || !visible(widget)) continue;
    const label = clean(labelEl.textContent).replace(/\\s*\\*$/, '');
    const options = Array.from(widget.querySelectorAll('[role="option"]')).map((o) => ({ value: clean(o.textContent), label: clean(o.textContent) })).filter((o) => o.value).slice(0, 200);
    fields.push({ key: keyFor(label), label, type: 'select', selector: labelEl.htmlFor ? '.fi-fo-field:has(label[for="' + CSS.escape(labelEl.htmlFor) + '"]) .fi-select-input' : selectorFor(widget) + '.fi-select-input', required: Boolean(labelEl.querySelector('sup')) || /\\*\\s*$/.test(clean(labelEl.textContent)), options });
  }
  for (const [name, group] of radios) fields.push({ key: keyFor(group.label), label: group.label, type: 'radio', selector: 'input[type="radio"][name="' + name.replace(/"/g, '\\\\"') + '"]', required: group.required, options: group.options });
  const buttons = Array.from(root.querySelectorAll('button, input[type="submit"]')).filter(visible);
  const submitEl = buttons.find((b) => (b.getAttribute('type') || 'submit').toLowerCase() === 'submit' && b.closest('form'))
    || buttons.find((b) => /save|create|add|publish|submit|post/i.test(b.innerText || b.value || ''));
  const submit = submitEl ? { selector: selectorFor(submitEl), label: clean(submitEl.innerText || submitEl.value || 'Submit') } : null;
  const links = [];
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    try { const u = new URL(a.getAttribute('href'), location.href); if (u.origin === location.origin) links.push({ text: clean(a.innerText), href: u.toString() }); } catch {}
    if (links.length >= 300) break;
  }
  const headings = Array.from(document.querySelectorAll('h1, h2')).map((h) => clean(h.innerText)).filter(Boolean).slice(0, 10);
  return { fields: fields.slice(0, 60), submit, links, headings };
})()`;

export async function inspectAdminPage(input: AdminSession, options: Options = {}): Promise<FormSnapshot> {
  return openPage(input, options, false, async (page) => {
    const title = (await page.title()).slice(0, 200);
    if (await signedOut(page)) return { url: page.url(), title, loggedIn: false, fields: [], submit: null, links: [], headings: [] };
    const found = await page.evaluate<Omit<FormSnapshot, 'url' | 'title' | 'loggedIn'>>(INSPECT_SCRIPT);
    return { url: page.url(), title, loggedIn: true, ...found };
  });
}

/** Messages a form shows: browser validation on invalid controls, and the site's own visible errors. */
const ERRORS_SCRIPT = `(() => {
  const clean = (t) => String(t || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const out = [];
  for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
    if (el.willValidate && !el.checkValidity()) {
      const label = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
      out.push((label ? clean(label.innerText) + ': ' : '') + clean(el.validationMessage));
    }
  }
  for (const el of Array.from(document.querySelectorAll('[role="alert"], .error, .errors, .invalid-feedback, .field-error, .form-error, [class*="error-message"], [aria-invalid="true"] + *'))) {
    const t = clean(el.innerText);
    if (t && visible(el)) out.push(t);
  }
  return Array.from(new Set(out)).slice(0, 10);
})()`;

async function shot(page: Page): Promise<string | null> {
  try {
    let image = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: true });
    if (image.length > 700_000) image = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: false });
    return image.toString('base64');
  } catch {
    return null;
  }
}

export async function fillAdminForm(
  input: AdminSession & { fields: FormField[]; values: Record<string, string | boolean>; submit: boolean; submitSelector?: string | null },
  options: Options = {}
): Promise<FillResult> {
  return openPage(input, options, input.submit, async (page) => {
    const title = (await page.title()).slice(0, 200);
    if (await signedOut(page)) return { url: page.url(), title, loggedIn: false, submitted: false, missing: [], errors: ['The admin session is no longer signed in.'], text: '', screenshot: null };
    const missing: string[] = [];
    const errors: string[] = [];
    // Search remote choices before filling other controls, so lookup requests
    // contain no pending form updates during a read-only preview.
    const ordered = [...input.fields.slice(0, 60)].sort((a, b) => Number(b.selector.includes('.fi-select-input')) - Number(a.selector.includes('.fi-select-input')));
    for (const field of ordered) {
      const value = input.values[field.key];
      if (value === undefined || value === null || value === '') continue;
      try {
        if (field.type === 'radio') {
          const option = page.locator(`${field.selector}[value="${String(value).replace(/"/g, '\\"')}"]`).first();
          if (!(await option.count())) { missing.push(field.key); continue; }
          await option.check({ timeout: 5000 });
          continue;
        }
        const control = page.locator(field.selector).first();
        if (!(await control.count())) { missing.push(field.key); continue; }
        if (field.type === 'file') continue;
        if (field.type === 'checkbox') await control.setChecked(value === true || value === 'true' || value === 'yes', { timeout: 5000 });
        else if (field.type === 'select' && field.selector.includes('.fi-select-input')) {
          await control.locator('.fi-select-input-btn').click({ timeout: 5000 });
          const search = control.locator('input').first();
          if (await search.count()) { await search.fill(String(value), { timeout: 5000 }); await page.waitForTimeout(600); }
          await control.getByRole('option', { name: String(value), exact: true }).click({ timeout: 5000 });
        }
        else if (field.type === 'select') await control.selectOption({ value: String(value) }, { timeout: 5000 }).catch(() => control.selectOption({ label: String(value) }, { timeout: 5000 }));
        else {
          // Blurring a previous control can trigger a reactive recalculation. Let
          // that finish before applying the next explicitly prepared value.
          await control.focus({ timeout: 5000 });
          await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => undefined);
          await control.fill(String(value), { timeout: 5000 });
        }
      } catch (error) {
        errors.push(`${field.label}: could not be filled (${error instanceof Error ? error.message.split('\n')[0]!.slice(0, 120) : 'unknown'})`);
      }
    }
    if (!input.submit || missing.length || errors.length) {
      return { url: page.url(), title, loggedIn: true, submitted: false, missing, errors, text: '', screenshot: await shot(page) };
    }
    const invalid = await page.evaluate<string[]>(ERRORS_SCRIPT);
    if (invalid.length) return { url: page.url(), title, loggedIn: true, submitted: false, missing, errors: invalid, text: '', screenshot: await shot(page) };
    const button = input.submitSelector ? page.locator(input.submitSelector).first() : null;
    if (!button || !(await button.count())) return { url: page.url(), title, loggedIn: true, submitted: false, missing: ['submit'], errors: ['The save button was not found.'], text: '', screenshot: await shot(page) };
    await button.click({ timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const after = await page.evaluate<string[]>(ERRORS_SCRIPT);
    const text = String(await page.evaluate<string>('document.body ? document.body.innerText : ""')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
    return { url: page.url(), title: (await page.title()).slice(0, 200), loggedIn: true, submitted: true, missing, errors: after, text, screenshot: await shot(page) };
  });
}
