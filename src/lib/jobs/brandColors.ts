import sharp from 'sharp';
import { fetchPublic } from '@/lib/publishing/fetchPublic';

const HEX = /^#[0-9a-f]{6}$/i;
const NEUTRAL_PRIMARY = '#111827';
const NEUTRAL_ACCENT = '#6b7280';
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;

/**
 * The two strongest colours actually in a logo, or quiet neutrals for a black-and-white one. Most small companies publish no
 * style guide, and a colour read from their own logo is better evidence than a model's guess.
 */
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

/** Fills colours a record left empty or invalid, from its own logo, and says so. A valid colour is left alone, and any failure is left for the normal checks to report. */
export async function fillBrandColors(values: Record<string, unknown>): Promise<void> {
  const valid = (key: string) => typeof values[key] === 'string' && HEX.test(values[key] as string);
  if (valid('primary_color') && valid('secondary_color')) return;
  if (typeof values.logo !== 'string' || !values.logo) return;
  try {
    const image = await fetchPublic(values.logo, { accept: 'image/*', maxBytes: 3_000_000 });
    const colors = await logoColors(image.bytes);
    if (!valid('primary_color')) values.primary_color = colors.primary;
    if (!valid('secondary_color')) values.secondary_color = colors.accent;
    values.colors_source = 'Read from the official logo by Nucleas';
  } catch (error) {
    console.warn('[signature] could not read colours from the logo', error instanceof Error ? error.message : 'unknown');
  }
}
