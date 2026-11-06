import sharp from 'sharp';
import { fetchPublic, fetchPublicText } from '@/lib/publishing/fetchPublic';

const HEX = /^#[0-9a-f]{6}$/i;
const NEUTRAL_PRIMARY = '#111827';
const NEUTRAL_ACCENT = '#6b7280';
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;

/**
 * The two strongest colours actually in a logo, or quiet neutrals for a black-and-white one. Most small companies publish no
 * style guide, and a colour read from their own logo is better evidence than a model's guess.
 */
export const isNeutralColors = (colors: { primary: string; accent: string }) => colors.primary === NEUTRAL_PRIMARY;

export async function logoColors(image: Buffer | Uint8Array): Promise<{ primary: string; accent: string }> {
  const { data, info } = await sharp(image).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index < data.length; index += info.channels) {
    const [r, g, b, alpha] = [data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!];
    if (alpha < 128) continue;
    const brightest = Math.max(r, g, b);
    const darkest = Math.min(r, g, b);
    // White, black and grey are usually the background or the type, not the brand.
    if (brightest - darkest < 40 || brightest < 40 || darkest > 225) continue;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const colors = [...buckets.values()].sort((a, b) => b.count - a.count).map((bucket) => ({ r: Math.round(bucket.r / bucket.count), g: Math.round(bucket.g / bucket.count), b: Math.round(bucket.b / bucket.count) }));
  const first = colors[0];
  if (!first) return { primary: NEUTRAL_PRIMARY, accent: NEUTRAL_ACCENT };
  const distance = (other: typeof first) => Math.abs(first.r - other.r) + Math.abs(first.g - other.g) + Math.abs(first.b - other.b);
  const second = colors.find((color) => distance(color) > 90);
  return { primary: toHex(first.r, first.g, first.b), accent: second ? toHex(second.r, second.g, second.b) : NEUTRAL_ACCENT };
}

/** Any way a color is written in a page, as lowercase #rrggbb. Anything else, such as var(--x), is not a color we can read. */
function toColor(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(text)?.[1];
  if (hex) return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(text);
  return rgb ? toHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) : null;
}

const parts = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];

/** White, black and grey say nothing about a brand. */
function hasColor(hex: string): boolean {
  const [r, g, b] = parts(hex);
  const brightest = Math.max(r, g, b);
  const darkest = Math.min(r, g, b);
  return brightest - darkest >= 40 && brightest >= 40 && darkest <= 225;
}

/** Too pale to read on a white signature, as yellow is: fine as an accent, not for a name. */
function tooPaleForText(hex: string): boolean {
  const [r, g, b] = parts(hex).map((part) => {
    const value = part / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) < 3;
}

const FAR_APART = 90;

/**
 * The colors a site itself names as its brand: its browser theme color, its pinned-tab color, and style variables
 * called brand, primary, accent or main. Not simply its most used colors, because those are often a review widget's
 * or an embedded app's, and not icons of other companies set inline in the page. Null when it names none.
 */
export function siteColors(html: string, css: string): { primary: string; accent: string } | null {
  const named: string[] = [];
  for (const tag of html.match(/<(?:meta|link)\b[^>]*>/gi) ?? []) {
    if (!/\b(?:theme-color|msapplication-TileColor|mask-icon)\b/i.test(tag)) continue;
    const value = /\b(?:content|color)=["']([^"']+)["']/i.exec(tag)?.[1];
    if (value) named.push(value);
  }
  for (const match of css.matchAll(/(?:^|[\s;{])--(?:color-|theme-)?(?:brand|primary|accent|main)(?:-color)?\s*:\s*([^;}]{1,40})/gi)) named.push(match[1]!);
  const colors = [...new Set(named.map(toColor))].filter((color): color is string => Boolean(color) && hasColor(color!));
  const first = colors[0];
  if (!first) return null;
  const distance = (other: string) => {
    const [a, b] = [parts(first), parts(other)];
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  };
  const second = colors.find((color) => distance(color) > FAR_APART);
  if (tooPaleForText(first)) return { primary: second && !tooPaleForText(second) ? second : NEUTRAL_PRIMARY, accent: first };
  return { primary: first, accent: second ?? NEUTRAL_ACCENT };
}

const MAX_STYLESHEETS = 3;

/** Reads a company's homepage and its own stylesheets. Stylesheets on other sites belong to someone else's widget. */
async function websiteColors(website: string): Promise<{ primary: string; accent: string } | null> {
  const page = await fetchPublicText(website, { accept: 'text/html' });
  const home = new URL(page.url);
  const sameSite = (url: URL) => url.hostname.replace(/^www\./, '') === home.hostname.replace(/^www\./, '');
  const sheets = (page.text.match(/<link\b[^>]*>/gi) ?? [])
    .filter((tag) => /\brel=["']?stylesheet/i.test(tag))
    .flatMap((tag) => {
      const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
      try {
        const url = href ? new URL(href, home) : null;
        return url && sameSite(url) ? [url.href] : [];
      } catch {
        return [];
      }
    })
    .slice(0, MAX_STYLESHEETS);
  const css = await Promise.all(sheets.map((sheet) => fetchPublicText(sheet, { accept: 'text/css' }).then((res) => res.text).catch(() => '')));
  const inline = (page.text.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []).join('\n');
  return siteColors(page.text, [inline, ...css].join('\n'));
}

/** Fills colours a record left empty or invalid: from its own logo, or its website when the logo has no color, and says so. A valid colour is left alone, and any failure is left for the normal checks to report. */
export async function fillBrandColors(values: Record<string, unknown>): Promise<void> {
  const valid = (key: string) => typeof values[key] === 'string' && HEX.test(values[key] as string);
  if (valid('primary_color') && valid('secondary_color')) return;
  const attempt = async <T>(what: string, read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch (error) {
      console.warn(`[signature] could not read colours from the ${what}`, error instanceof Error ? error.message : 'unknown');
      return null;
    }
  };
  const fromLogo = typeof values.logo === 'string' && values.logo
    ? await attempt('logo', async () => logoColors((await fetchPublic(values.logo as string, { accept: 'image/*', maxBytes: 3_000_000 })).bytes))
    : null;
  // A logo with no color of its own says nothing about the brand, so the site gets to speak before settling for neutrals.
  const fromSite = (!fromLogo || isNeutralColors(fromLogo)) && typeof values.website === 'string' && values.website
    ? await attempt('website', () => websiteColors(values.website as string))
    : null;
  const colors = fromSite ?? fromLogo;
  if (!colors) return;
  if (!valid('primary_color')) values.primary_color = colors.primary;
  if (!valid('secondary_color')) values.secondary_color = colors.accent;
  values.colors_source = fromSite ? 'Read from the company website by Nucleas' : isNeutralColors(colors) ? 'Quiet neutrals chosen by Nucleas, because neither the official logo nor the website names a color' : 'Read from the official logo by Nucleas';
}
