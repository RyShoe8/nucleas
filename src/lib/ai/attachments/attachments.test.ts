import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { Types } from 'mongoose';

vi.mock('server-only', () => ({}));

const blobs = vi.hoisted(() => ({ store: new Map<string, Uint8Array>(), deleted: [] as string[] }));
vi.mock('@vercel/blob', () => ({
  get: async (pathname: string) => {
    const bytes = blobs.store.get(pathname);
    return bytes ? { stream: new Blob([Buffer.from(bytes)]).stream() } : null;
  },
  del: async (pathname: string) => {
    blobs.deleted.push(pathname);
  },
}));
const describe_ = vi.hoisted(() => vi.fn());
vi.mock('./describeImage', () => ({ describeImage: (...args: unknown[]) => describe_(...args) }));

import { attachmentKind, extractAttachment, renderAttachments, MAX_TEXT_PER_FILE } from './extract';
import { parseAttachmentRefs, processAttachments, uploadPrefix } from './uploads';

const enc = (s: string) => new TextEncoder().encode(s);

/** A minimal one-page PDF whose page says "Hello PDF". */
function tinyPdf(): Uint8Array {
  const content = 'BT /F1 18 Tf 20 100 Td (Hello PDF) Tj ET';
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(body);
}

describe('extracting attachments', () => {
  it('recognises text, code, PDFs and images, and refuses the rest', () => {
    expect(attachmentKind('notes.md', '')).toBe('text');
    expect(attachmentKind('app.tsx', 'application/octet-stream')).toBe('text');
    expect(attachmentKind('data.csv', 'text/csv')).toBe('text');
    expect(attachmentKind('report.pdf', 'application/pdf')).toBe('pdf');
    expect(attachmentKind('shot.png', 'image/png')).toBe('image');
    expect(attachmentKind('archive.zip', 'application/zip')).toBeNull();
  });

  it('reads text and caps very long files', async () => {
    const small = await extractAttachment({ name: 'a.txt', mime: 'text/plain', bytes: enc('hello\nworld') });
    expect(small).toMatchObject({ kind: 'text', text: 'hello\nworld', truncated: false });
    const big = await extractAttachment({ name: 'big.log', mime: 'text/plain', bytes: enc('x'.repeat(MAX_TEXT_PER_FILE + 10)) });
    expect(big.text).toHaveLength(MAX_TEXT_PER_FILE);
    expect(big.truncated).toBe(true);
    expect((await extractAttachment({ name: 'a.zip', mime: 'application/zip', bytes: enc('PK') })).error).toMatch(/not supported/);
  });

  it('extracts PDF text page by page', async () => {
    const pdf = await extractAttachment({ name: 'doc.pdf', mime: 'application/pdf', bytes: tinyPdf() });
    expect(pdf.error).toBeUndefined();
    expect(pdf.text).toContain('--- Page 1 ---');
    expect(pdf.text).toContain('Hello PDF');
  });

  it('shrinks images to at most 1600px JPEG for the vision model', async () => {
    const png = await sharp({ create: { width: 3200, height: 1000, channels: 3, background: '#336699' } }).png().toBuffer();
    const image = await extractAttachment({ name: 'wide.png', mime: 'image/png', bytes: new Uint8Array(png) });
    expect(image.imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    const meta = await sharp(Buffer.from(image.imageDataUrl!.split(',')[1], 'base64')).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(500);
  });

  it('renders files for the models within an overall cap, noting failures', () => {
    const block = renderAttachments(
      [
        { name: 'a.txt', kind: 'text', text: 'A'.repeat(100) },
        { name: 'b.txt', kind: 'text', text: 'B'.repeat(100) },
        { name: 'c.zip', kind: 'text', error: 'not supported' },
      ],
      150
    );
    expect(block).toContain('File "a.txt"');
    expect(block).toContain('[…truncated]');
    expect(block).toContain('Could not be used: not supported');
    expect((block.match(/[AB]/g) ?? []).length).toBe(150);
  });
});

describe('attachment references', () => {
  const user = 'u'.repeat(24);
  it("accepts only the sender's own uploads", () => {
    expect(parseAttachmentRefs([{ pathname: `${uploadPrefix(user)}1-a.txt`, name: 'a.txt' }], user)).toEqual([
      { pathname: `${uploadPrefix(user)}1-a.txt`, name: 'a.txt', mime: '', size: 0, access: 'private' },
    ]);
    expect(parseAttachmentRefs([{ pathname: 'ask/someone-else/1-a.txt', name: 'a.txt' }], user)).toEqual({ error: 'That attachment does not belong to you.' });
    expect(parseAttachmentRefs([{ pathname: `${uploadPrefix(user)}../x`, name: 'x' }], user)).toMatchObject({ error: expect.any(String) });
    expect(parseAttachmentRefs(Array.from({ length: 7 }, (_, i) => ({ pathname: `${uploadPrefix(user)}${i}`, name: 'f' })), user)).toMatchObject({ error: expect.stringMatching(/at most/) });
  });
});

describe('processing uploads', () => {
  const user = 'u'.repeat(24);
  beforeEach(() => {
    blobs.store.clear();
    blobs.deleted.length = 0;
    describe_.mockReset();
  });

  it('reads each file, describes images, and deletes every upload afterwards', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    blobs.store.set(`${uploadPrefix(user)}1-notes.md`, enc('# Launch\nRevenue was 12,345 last week.'));
    blobs.store.set(`${uploadPrefix(user)}2-shot.png`, new Uint8Array(png));
    describe_.mockResolvedValue({ ok: true, text: 'A dashboard showing 4,200 sessions.', model: 'Qwen/Qwen3-VL-8B-Thinking-FP8', costMicros: 0 });
    const result = await processAttachments({
      refs: [
        { pathname: `${uploadPrefix(user)}1-notes.md`, name: 'notes.md', mime: 'text/markdown', size: 40, access: 'private' },
        { pathname: `${uploadPrefix(user)}2-shot.png`, name: 'shot.png', mime: 'image/png', size: png.byteLength, access: 'private' },
        { pathname: `${uploadPrefix(user)}3-missing.txt`, name: 'missing.txt', mime: 'text/plain', size: 1, access: 'private' },
      ],
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: user,
      level: 'low',
    });
    expect(result.items.map((i) => [i.name, i.kind, i.error ?? null])).toEqual([
      ['notes.md', 'text', null],
      ['shot.png', 'image', null],
      ['missing.txt', 'text', 'The upload was not found. Attach it again.'],
    ]);
    expect(result.block).toContain('Revenue was 12,345 last week.');
    expect(result.block).toContain('Image "shot.png" (described by a vision model)');
    expect(result.block).toContain('4,200 sessions');
    expect(describe_).toHaveBeenCalledWith(expect.objectContaining({ level: 'low', name: 'shot.png', imageDataUrl: expect.stringMatching(/^data:image\/jpeg/) }));
    expect(blobs.deleted.sort()).toEqual([`${uploadPrefix(user)}1-notes.md`, `${uploadPrefix(user)}2-shot.png`, `${uploadPrefix(user)}3-missing.txt`]);
  });

  it('reports a vision failure on the image instead of inventing a description', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
    blobs.store.set(`${uploadPrefix(user)}1-shot.png`, new Uint8Array(png));
    describe_.mockResolvedValue({ ok: false, text: 'No vision model is available, so the image could not be read.', model: null, costMicros: null });
    const result = await processAttachments({
      refs: [{ pathname: `${uploadPrefix(user)}1-shot.png`, name: 'shot.png', mime: 'image/png', size: 1, access: 'private' }],
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: user,
      level: 'low',
    });
    expect(result.items[0].error).toMatch(/No vision model/);
    expect(result.block).toContain('Could not be used');
  });
});
