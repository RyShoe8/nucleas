import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

const fetched = vi.hoisted(() => ({ fetchPublic: vi.fn() }));
vi.mock('@/lib/publishing/fetchPublic', () => ({ fetchPublic: fetched.fetchPublic }));
import { fillBrandColors, logoColors } from './brandColors';

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
