import 'server-only';
import { del, get } from '@vercel/blob';
import { Types } from 'mongoose';
import type { CostLevel } from '@/lib/ai/engine/select';
import { attachmentKind, extractAttachment, MAX_FILES, renderAttachments, type AttachmentKind } from './extract';
import { describeImage } from './describeImage';

/**
 * Ask attachments: the browser uploads each file straight to private Vercel Blob storage (no size
 * limit on our side), then sends only the references. Here each file is checked to be the sender's
 * own upload, read, turned into text, and deleted.
 */

/** Every Ask upload lives under the uploader's own folder. */
export function uploadPrefix(userId: string): string {
  return `ask/${userId}/`;
}

export interface AttachmentRef {
  pathname: string;
  name: string;
  mime: string;
  size: number;
  access: 'private' | 'public';
}

export function parseAttachmentRefs(value: unknown, userId: string): AttachmentRef[] | { error: string } {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return { error: 'attachments must be a list.' };
  if (value.length > MAX_FILES) return { error: `Attach at most ${MAX_FILES} files per message.` };
  const refs: AttachmentRef[] = [];
  for (const raw of value) {
    const r = raw as Partial<AttachmentRef>;
    if (typeof r.pathname !== 'string' || typeof r.name !== 'string') return { error: 'Each attachment needs a pathname and name.' };
    // Only files this user uploaded through Ask can be read, never an arbitrary URL.
    if (!r.pathname.startsWith(uploadPrefix(userId)) || r.pathname.includes('..')) return { error: 'That attachment does not belong to you.' };
    refs.push({
      pathname: r.pathname,
      name: r.name.slice(0, 200),
      mime: typeof r.mime === 'string' ? r.mime.slice(0, 120) : '',
      size: typeof r.size === 'number' && r.size >= 0 ? r.size : 0,
      access: r.access === 'public' ? 'public' : 'private',
    });
  }
  return refs;
}

/** Text files only need their start (models get the first ~60k characters). */
const TEXT_READ_LIMIT = 2 * 1024 * 1024;

async function readBlob(ref: AttachmentRef, limit: number | null): Promise<Uint8Array | null> {
  const result = await get(ref.pathname, { access: ref.access });
  if (!result?.stream) return null;
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (limit !== null && size >= limit) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return limit !== null ? bytes.slice(0, limit) : bytes;
}

export interface ProcessedAttachment {
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  text?: string;
  truncated?: boolean;
  error?: string;
  /** Images: the vision model used. */
  describedBy?: string | null;
}

export interface ProcessedAttachments {
  items: ProcessedAttachment[];
  /** The content block given to models. */
  block: string;
  costMicros: number;
}

export async function processAttachments(input: {
  refs: AttachmentRef[];
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  level: CostLevel;
  signal?: AbortSignal;
}): Promise<ProcessedAttachments> {
  const items: ProcessedAttachment[] = [];
  let costMicros = 0;
  for (const ref of input.refs) {
    const kind = attachmentKind(ref.name, ref.mime);
    try {
      const bytes = await readBlob(ref, kind === 'text' ? TEXT_READ_LIMIT : null);
      if (!bytes) {
        items.push({ name: ref.name, mime: ref.mime, size: ref.size, kind: kind ?? 'text', error: 'The upload was not found. Attach it again.' });
        continue;
      }
      const extracted = await extractAttachment({ name: ref.name, mime: ref.mime, bytes });
      const item: ProcessedAttachment = {
        name: extracted.name,
        mime: extracted.mime,
        size: ref.size || extracted.size,
        kind: extracted.kind,
        text: extracted.text,
        truncated: extracted.truncated || (kind === 'text' && bytes.byteLength >= TEXT_READ_LIMIT && ref.size > TEXT_READ_LIMIT),
        error: extracted.error,
      };
      if (extracted.imageDataUrl) {
        const described = await describeImage({
          organizationId: input.organizationId,
          projectId: input.projectId,
          userId: input.userId,
          level: input.level,
          name: ref.name,
          imageDataUrl: extracted.imageDataUrl,
          signal: input.signal,
        });
        costMicros += described.costMicros ?? 0;
        item.describedBy = described.model;
        if (described.ok) item.text = described.text;
        else item.error = described.text;
      }
      items.push(item);
    } catch {
      items.push({ name: ref.name, mime: ref.mime, size: ref.size, kind: kind ?? 'text', error: 'The file could not be read.' });
    } finally {
      // Nothing is kept in storage once the file has been read.
      await del(ref.pathname).catch(() => undefined);
    }
  }
  return { items, block: renderAttachments(items), costMicros };
}
