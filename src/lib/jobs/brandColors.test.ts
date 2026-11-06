import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

const fetched = vi.hoisted(() => ({ fetchPublic: vi.fn(), fetchPublicText: vi.fn() }));
vi.mock('@/lib/publishing/fetchPublic', () => ({ fetchPublic: fetched.fetchPublic, fetchPublicText: fetched.fetchPublicText }));
import { fillBrandColors, logoColors, siteColors } from './brandColors';

const solid = (r: number, g: number, b: number, width = 40, height = 40) => sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png().toBuffer();
async function twoColor() {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .composite([{ input: await solid(30, 90, 200, 20, 40), left: 20, top: 0 }, { input: await solid(200, 40, 40, 20, 40), left: 0, top: 0 }])
    .png().toBuffer();
}

describe('reading colours from a logo', () => {
  it('finds the logo\'s two colours', async () => {
    const colors = await logoColors(await twoColor());
    expect([colors.primary, colors.accent].sort()).toEqual(['#1e5ac8', '#c82828']);
  });

  it('uses quiet neutrals for a black-and-white logo, rather than inventing a colour', async () => {
    expect(await logoColors(await solid(18, 18, 18))).toEqual({ primary: '#111827', accent: '#6b7280' });
    expect(await logoColors(await solid(255, 255, 255))).toEqual({ primary: '#111827', accent: '#6b7280' });
  });

  it('gives a one-colour logo a neutral accent', async () => {
    expect(await logoColors(await solid(200, 40, 40))).toEqual({ primary: '#c82828', accent: '#6b7280' });
  });
});

describe('filling a record', () => {
  it('fills empty colours from the logo and says where they came from', async () => {
    fetched.fetchPublic.mockResolvedValueOnce({ bytes: await solid(200, 40, 40) });
    const values: Record<string, unknown> = { logo: 'https://site.com/logo.png', primary_color: '', secondary_color: null };
    await fillBrandColors(values);
    expect(values).toMatchObject({ primary_color: '#c82828', secondary_color: '#6b7280', colors_source: 'Read from the official logo by Nucleas' });
  });

  it('leaves valid colours alone and does not fetch', async () => {
    fetched.fetchPublic.mockClear();
    const values: Record<string, unknown> = { logo: 'https://site.com/logo.png', primary_color: '#123456', secondary_color: '#abcdef' };
    await fillBrandColors(values);
    expect(fetched.fetchPublic).not.toHaveBeenCalled();
    expect(values.primary_color).toBe('#123456');
  });

  it('leaves the fields empty for the normal check to report when the logo cannot be read', async () => {
    fetched.fetchPublic.mockRejectedValueOnce(new Error('blocked'));
    const values: Record<string, unknown> = { logo: 'https://site.com/logo.png', primary_color: '' };
    await fillBrandColors(values);
    expect(values.primary_color).toBe('');
    expect(values.colors_source).toBeUndefined();
  });
});

describe('reading colours from a website', () => {
  it('uses the theme color a site declares, as Buttondown does', () => {
    expect(siteColors('<meta name="theme-color" content="#0069FF"/>', '')).toEqual({ primary: '#0069ff', accent: '#6b7280' });
  });

  it('reads brand style variables, however they are written', () => {
    expect(siteColors('', ':root{--color-brand:#0069ff;--accent: rgb(200, 40, 40)}')).toEqual({ primary: '#0069ff', accent: '#c82828' });
    expect(siteColors('', ':root{--primary:#c33}')).toEqual({ primary: '#cc3333', accent: '#6b7280' });
  });

  it('keeps a color too pale to read as the accent, as with Transistor\'s yellow', () => {
    expect(siteColors('', ':root{--accent:#fbc75d}')).toEqual({ primary: '#111827', accent: '#fbc75d' });
    expect(siteColors('', ':root{--accent:#fbc75d;--brand:#0069ff}')).toEqual({ primary: '#0069ff', accent: '#fbc75d' });
  });

  it('ignores what is not the company\'s own brand', () => {
    // A review widget, a checkout, other companies' icons set inline, and a dark-mode background.
    const css = ':root{--jdgm-primary-color:#108474;--shopify-accent:#108474;--color-background-primary:#0a0a0a}.a{color:#108474;color:#108474}';
    expect(siteColors('<svg style="--brand-color: rgb(135, 46, 196)"></svg>', css)).toBeNull();
  });

  it('does not treat black, white, grey or an unreadable value as a brand, as on Pirsch', () => {
    const html = '<meta name="theme-color" content="#f8f5ed" /><link rel="mask-icon" href="/x.svg" color="#0a0a0a" /><meta name="theme-color" content="">';
    expect(siteColors(html, ':root{--color-primary: var(--black)}')).toBeNull();
  });
});

describe('choosing where colours come from', () => {
  const page = (url: string, text: string) => ({ url, contentType: 'text/html', text });
  const noColor = async () => ({ url: 'https://co.com/logo.png', contentType: 'image/png', bytes: await solid(18, 18, 18) });

  it('prefers a logo that has color, without opening the website', async () => {
    fetched.fetchPublicText.mockReset();
    fetched.fetchPublic.mockResolvedValueOnce({ url: 'https://co.com/logo.png', contentType: 'image/png', bytes: await twoColor() });
    const values: Record<string, unknown> = { logo: 'https://co.com/logo.png', website: 'https://co.com/' };
    await fillBrandColors(values);
    expect(fetched.fetchPublicText).not.toHaveBeenCalled();
    expect(values.colors_source).toBe('Read from the official logo by Nucleas');
  });

  it('turns to the website when the logo has no color, reading its own stylesheets only', async () => {
    fetched.fetchPublicText.mockReset();
    fetched.fetchPublic.mockResolvedValueOnce(await noColor());
    const html = '<link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="https://widget.com/w.css">';
    fetched.fetchPublicText.mockImplementation(async (url: string) => (url === 'https://co.com/' ? page(url, html) : page(url, ':root{--brand:#0069ff}')));
    const values: Record<string, unknown> = { logo: 'https://co.com/logo.png', website: 'https://co.com/' };
    await fillBrandColors(values);
    expect(fetched.fetchPublicText.mock.calls.map((call) => call[0])).toEqual(['https://co.com/', 'https://co.com/site.css']);
    expect(values).toMatchObject({ primary_color: '#0069ff', secondary_color: '#6b7280', colors_source: 'Read from the company website by Nucleas' });
  });

  it('settles for neutrals when neither names a color, or the website cannot be read', async () => {
    for (const site of [async () => page('https://co.com/', '<p>Plain</p>'), async () => { throw new Error('blocked'); }]) {
      fetched.fetchPublicText.mockReset();
      fetched.fetchPublic.mockResolvedValueOnce(await noColor());
      fetched.fetchPublicText.mockImplementation(site);
      const values: Record<string, unknown> = { logo: 'https://co.com/logo.png', website: 'https://co.com/' };
      await fillBrandColors(values);
      expect(values.primary_color).toBe('#111827');
      expect(String(values.colors_source)).toContain('Quiet neutrals');
    }
  });

  it('never replaces a color the record already has', async () => {
    fetched.fetchPublicText.mockReset();
    fetched.fetchPublic.mockResolvedValueOnce(await noColor());
    fetched.fetchPublicText.mockResolvedValue(page('https://co.com/', '<meta name="theme-color" content="#0069ff">'));
    const values: Record<string, unknown> = { logo: 'https://co.com/logo.png', website: 'https://co.com/', primary_color: '#abcdef' };
    await fillBrandColors(values);
    expect(values).toMatchObject({ primary_color: '#abcdef', secondary_color: '#6b7280' });
  });
});
