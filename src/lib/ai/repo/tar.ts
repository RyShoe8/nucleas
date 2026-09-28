import { gunzipSync } from 'node:zlib';

/**
 * Minimal reader for the gzipped tar archives GitHub serves for a commit. Handles ustar names with
 * prefixes, PAX extended headers (long paths) and GNU long names; skips everything but files.
 */

export interface TarFile {
  /** Path inside the repository (GitHub's top-level "owner-repo-sha/" folder removed). */
  path: string;
  bytes: Uint8Array;
}

function field(block: Uint8Array, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return Buffer.from(end === -1 ? raw : raw.subarray(0, end)).toString('utf8');
}

function octal(block: Uint8Array, start: number, length: number): number {
  const text = field(block, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

function paxPath(data: Uint8Array): string | null {
  // Records look like "<len> key=value\n".
  const text = Buffer.from(data).toString('utf8');
  for (const record of text.split('\n')) {
    const eq = record.indexOf('=');
    const space = record.indexOf(' ');
    if (space > -1 && eq > space && record.slice(space + 1, eq) === 'path') return record.slice(eq + 1);
  }
  return null;
}

export function readTarGz(archive: Uint8Array, options: { stripFirst?: boolean } = {}): TarFile[] {
  const tar = gunzipSync(archive);
  const files: TarFile[] = [];
  let offset = 0;
  let nextPath: string | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      nextPath = paxPath(data) ?? nextPath;
      continue;
    }
    if (type === 'L') {
      nextPath = Buffer.from(data).toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'g') continue;
    const prefix = field(header, 345, 155);
    const name = nextPath ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    nextPath = null;
    if (type !== '0' && type !== '7') continue;
    const path = options.stripFirst === false ? name : name.split('/').slice(1).join('/');
    if (path) files.push({ path, bytes: new Uint8Array(data) });
  }
  return files;
}
