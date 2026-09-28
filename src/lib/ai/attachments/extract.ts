import 'server-only';
import sharp from 'sharp';

/**
 * Files attached to an Ask message. Text-like files and PDFs become text; images are shrunk and
 * handed to a vision model (see describeImage) so any model can use them.
 */

export const MAX_FILES = 6;
/** Vercel's request body limit is ~4.5 MB; stay under it for the whole message. */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
/** Characters of one file's text kept for the answer. */
export const MAX_TEXT_PER_FILE = 60_000;

export type AttachmentKind = 'text' | 'pdf' | 'image';

export interface ExtractedAttachment {
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** Text content (text files, PDFs), truncated. */
  text?: string;
  truncated?: boolean;
  /** Images: a JPEG data URL, at most 1600px on the long side. */
  imageDataUrl?: string;
  /** Why the file could not be used, when it could not. */
  error?: string;
}

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|php|sql|ya?ml|toml|ini|env\.example|log|sh|ps1|bat|c|h|cpp|hpp|cs|vue|svelte|graphql|gql|prisma)$/i;
const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif|avif|heic|heif)$/i;

export function attachmentKind(name: string, mime: string): AttachmentKind | null {
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (IMAGE_MIME.test(mime) || /\.(png|jpe?g|webp|gif|avif|heic|heif)$/i.test(name)) return 'image';
  if (mime.startsWith('text/') || /^application\/(json|xml|javascript|x-yaml|yaml|sql)/.test(mime) || TEXT_EXTENSIONS.test(name)) return 'text';
  return null;
}

function clip(text: string): { text: string; truncated: boolean } {
  const clean = text.replace(/\u0000/g, '').trim();
  return clean.length > MAX_TEXT_PER_FILE ? { text: clean.slice(0, MAX_TEXT_PER_FILE), truncated: true } : { text: clean, truncated: false };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((page, i) => `--- Page ${i + 1} ---\n${page}`).join('\n\n');
}

export async function extractAttachment(file: { name: string; mime: string; bytes: Uint8Array }): Promise<ExtractedAttachment> {
  const base = { name: file.name.slice(0, 200), mime: file.mime || 'application/octet-stream', size: file.bytes.byteLength };
  const kind = attachmentKind(file.name, file.mime);
  if (!kind) return { ...base, kind: 'text', error: 'This file type is not supported. Attach text, code, CSV, JSON, PDF or image files.' };
  try {
    if (kind === 'text') {
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(file.bytes);
      return { ...base, kind, ...clip(decoded) };
    }
    if (kind === 'pdf') {
      const text = await pdfText(file.bytes);
      if (!text.replace(/--- Page \d+ ---/g, '').trim()) {
        return { ...base, kind, error: 'No text found in this PDF (it may be scanned images). Attach the pages as images instead.' };
      }
      return { ...base, kind, ...clip(text) };
    }
    const jpeg = await sharp(file.bytes, { animated: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { ...base, kind, imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` };
  } catch {
    return { ...base, kind, error: kind === 'pdf' ? 'This PDF could not be read.' : kind === 'image' ? 'This image could not be read.' : 'This file could not be read.' };
  }
}

/** The block of attachment content given to models, capped overall. */
export function renderAttachments(items: { name: string; kind: AttachmentKind; text?: string; truncated?: boolean; error?: string }[], maxChars = 80_000): string {
  const parts: string[] = [];
  let used = 0;
  for (const a of items) {
    const label = a.kind === 'image' ? `Image "${a.name}" (described by a vision model)` : `File "${a.name}"`;
    if (a.error) {
      parts.push(`## ${label}\n(Could not be used: ${a.error})`);
      continue;
    }
    const room = Math.max(0, maxChars - used);
    const body = (a.text ?? '').slice(0, room);
    used += body.length;
    parts.push(`## ${label}\n${body}${a.truncated || body.length < (a.text ?? '').length ? '\n[…truncated]' : ''}`);
  }
  return parts.join('\n\n');
}
