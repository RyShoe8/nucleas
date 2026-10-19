import { describe, expect, it, vi } from 'vitest';
import { addLinkCandidates, addRecord, coerceValue, fillUserPrompt, learnAdminForm, listShows, listUrlFor, parseFill, valueLines, type AdminBrowser, type FormSnapshot } from './admin';
import type { AdminTarget, FormField } from './config';

const FIELDS: FormField[] = [
  { key: 'casino', label: 'Casino', type: 'text', selector: '#casino', required: true },
  { key: 'offer', label: 'Offer', type: 'textarea', selector: 'textarea[name="offer"]', required: true },
  { key: 'category', label: 'Category', type: 'select', selector: '#cat', required: false, options: [{ value: '', label: 'Choose…' }, { value: 'sweeps', label: 'Sweepstakes' }, { value: 'real', label: 'Real money' }] },
  { key: 'expires', label: 'Expires', type: 'date', selector: '#exp', required: false },
  { key: 'featured', label: 'Featured', type: 'checkbox', selector: 'input[name="featured"]', required: false },
  { key: 'logo', label: 'Logo', type: 'file', selector: '#logo', required: true },
];

describe('filling values', () => {
  it('fits each value to its control and drops what does not fit', () => {
    expect(coerceValue(FIELDS[2]!, 'Sweepstakes')).toBe('sweeps');
    expect(coerceValue(FIELDS[2]!, 'crypto')).toBeUndefined();
    expect(coerceValue(FIELDS[3]!, 'Nov 1, 2026')).toBe('2026-11-01');
    expect(coerceValue(FIELDS[3]!, 'soon')).toBeUndefined();
    expect(coerceValue(FIELDS[4]!, 'yes')).toBe(true);
    expect(coerceValue({ ...FIELDS[0]!, type: 'number' }, '$1,200')).toBe('1200');
    expect(coerceValue({ ...FIELDS[0]!, type: 'url' }, 'javascript:alert(1)')).toBeUndefined();
    expect(coerceValue(FIELDS[5]!, 'logo.png')).toBeUndefined();
  });

  it('reads the model’s JSON and says which required fields it could not fill (files are never asked for)', () => {
    expect(parseFill(FIELDS, '```json\n{"casino":"Golden Hearts","category":"sweeps","featured":false,"unknown":"x"}\n```')).toEqual({
      values: { casino: 'Golden Hearts', category: 'sweeps', featured: false },
      unfilled: ['Offer'],
    });
    expect(parseFill(FIELDS, 'no json here')).toBeNull();
  });

  it('lists the fields with their choices for the model, and reads values back as people see them', () => {
    const prompt = fillUserPrompt(FIELDS, { title: 'Double your first buy', description: '$20 → 40 SC', extra: ['From: Golden Hearts'] }, 'deal');
    expect(prompt).toContain('- category (select): Category [values: sweeps=Sweepstakes, real=Real money]');
    expect(prompt).toContain('- casino (text, required): Casino');
    expect(prompt).not.toContain('logo');
    expect(valueLines(FIELDS, { casino: 'Golden Hearts', category: 'sweeps', featured: true })).toEqual([
      { label: 'Casino', value: 'Golden Hearts' },
      { label: 'Category', value: 'Sweepstakes' },
      { label: 'Featured', value: 'Yes' },
    ]);
  });
});

describe('finding the form', () => {
  const links = [
    { text: 'Dashboard', href: 'https://fg.club/admin' },
    { text: 'Deals', href: 'https://fg.club/admin/deals' },
    { text: 'New deal', href: 'https://fg.club/admin/deals/new' },
    { text: 'New casino', href: 'https://fg.club/admin/casinos/new' },
  ];

  it('picks the add link for the item and the list page beside it', () => {
    expect(addLinkCandidates(links, 'deal').map((l) => l.href)).toEqual(['https://fg.club/admin/deals/new']);
    expect(listUrlFor('https://fg.club/admin/deals/new', links, 'deal')).toBe('https://fg.club/admin/deals');
    expect(listUrlFor('https://fg.club/admin/add-promo', links, 'deal')).toBe('https://fg.club/admin/deals');
  });

  const snapshot = (over: Partial<FormSnapshot>): FormSnapshot => ({ url: '', title: '', loggedIn: true, fields: [], submit: null, links: [], headings: [], ...over });
  const browser = (pages: Record<string, FormSnapshot>): AdminBrowser => ({
    inspect: async (_s, url) => pages[url] ?? snapshot({ url }),
    fill: vi.fn(),
    read: vi.fn(),
  });
  const session = { baseUrl: 'https://fg.club', cookies: [] };

  it('follows the admin home to the add form and learns it', async () => {
    const result = await learnAdminForm({
      session, request: 'Add the best casino deals from our email to the admin', noun: 'deal',
      browser: browser({
        'https://fg.club/admin': snapshot({ url: 'https://fg.club/admin', links: links.slice(0, 2) }),
        'https://fg.club/admin/deals': snapshot({ url: 'https://fg.club/admin/deals', links }),
        'https://fg.club/admin/deals/new': snapshot({ url: 'https://fg.club/admin/deals/new', fields: FIELDS, submit: { selector: 'button', label: 'Save deal' }, headings: ['New deal'] }),
      }),
    });
    expect(result).toMatchObject({ ok: true, target: { formUrl: 'https://fg.club/admin/deals/new', listUrl: 'https://fg.club/admin/deals', submit: { label: 'Save deal' } } });
  });

  it('uses an address in the request, and explains a signed-out session or a missing form', async () => {
    const pages = { 'https://fg.club/admin/promos/create': snapshot({ url: 'https://fg.club/admin/promos/create', fields: FIELDS, submit: { selector: 'button', label: 'Save' } }) };
    expect(await learnAdminForm({ session, request: 'Add deals at fg.club/admin/promos/create', noun: 'deal', browser: browser(pages) })).toMatchObject({ ok: true, target: { formUrl: 'https://fg.club/admin/promos/create', listUrl: 'https://fg.club/admin/promos' } });
    expect(await learnAdminForm({ session, request: 'Add deals', noun: 'deal', browser: browser({ 'https://fg.club/admin': snapshot({ loggedIn: false }) }) })).toMatchObject({ ok: false, error: expect.stringContaining('no longer signed in') });
    expect(await learnAdminForm({ session, request: 'Add deals', noun: 'deal', browser: browser({}) })).toMatchObject({ ok: false, error: expect.stringContaining('fg.club/admin/deals/new') });
  });
});

describe('adding a record', () => {
  const target: AdminTarget = { baseUrl: 'https://fg.club', formUrl: 'https://fg.club/admin/deals/new', listUrl: 'https://fg.club/admin/deals', fields: FIELDS.slice(0, 2), submit: { selector: 'button', label: 'Save' }, learnedAt: '2026-10-17' };
  const session = { baseUrl: 'https://fg.club', cookies: [] };
  const values = { casino: 'Golden Hearts', offer: '$20 → 40 SC' };
  const ok = { url: 'https://fg.club/admin/deals', title: '', loggedIn: true, submitted: true, missing: [], errors: [], text: '', screenshot: 'img' };

  it('refuses expired dates before sending anything to the admin', async () => {
    const browser: AdminBrowser = { inspect: vi.fn(), fill: vi.fn(), read: vi.fn() };
    expect(await addRecord({ session, target, values: { ...values, start_date: '2024-10-13', end_date: '2024-10-20' }, browser, refill: vi.fn() })).toMatchObject({ ok: false, code: 'rejected', error: expect.stringContaining('expired') });
    expect(browser.fill).not.toHaveBeenCalled();
  });

  it('saves, then confirms the record is on the list page', async () => {
    const browser: AdminBrowser = { inspect: vi.fn(), fill: vi.fn(async () => ok), read: vi.fn(async () => ({ loggedIn: true, text: 'Deals\nGolden Hearts — $20 → 40 SC' })) };
    expect(await addRecord({ session, target, values, browser, refill: vi.fn() })).toMatchObject({ ok: true, verified: true, url: 'https://fg.club/admin/deals', relearned: null });
    expect(listShows('nothing here', target.fields, values)).toBe(false);
  });

  it('learns a changed form again and retries once with values for the new fields', async () => {
    const renamed = [{ ...FIELDS[0]!, key: 'brand', label: 'Brand', selector: '#brand' }, FIELDS[1]!];
    const fill = vi.fn().mockResolvedValueOnce({ ...ok, submitted: false, missing: ['casino'] }).mockResolvedValueOnce(ok);
    const browser: AdminBrowser = { inspect: vi.fn(async () => ({ url: target.formUrl, title: '', loggedIn: true, fields: renamed, submit: { selector: 'button', label: 'Save' }, links: [], headings: [] })), fill, read: vi.fn(async () => ({ loggedIn: true, text: 'Golden Hearts' })) };
    const refill = vi.fn(async () => ({ brand: 'Golden Hearts', offer: '$20 → 40 SC' }));
    const outcome = await addRecord({ session, target, values, browser, refill });
    expect(outcome).toMatchObject({ ok: true, verified: true, relearned: { fields: renamed } });
    expect(fill.mock.calls[1]![1]).toMatchObject({ values: { brand: 'Golden Hearts' } });
  });

  it('reports the site’s own errors and an expired session without retrying', async () => {
    const rejected: AdminBrowser = { inspect: vi.fn(), fill: vi.fn(async () => ({ ...ok, errors: ['Casino is not on the approved list'] })), read: vi.fn() };
    expect(await addRecord({ session, target, values, browser: rejected, refill: vi.fn() })).toMatchObject({ ok: false, code: 'rejected', error: expect.stringContaining('approved list') });
    const expired: AdminBrowser = { inspect: vi.fn(), fill: vi.fn(async () => ({ ...ok, loggedIn: false, submitted: false })), read: vi.fn() };
    expect(await addRecord({ session, target, values, browser: expired, refill: vi.fn() })).toMatchObject({ ok: false, code: 'needs_reauth' });
    expect(rejected.fill).toHaveBeenCalledTimes(1);
  });
});
