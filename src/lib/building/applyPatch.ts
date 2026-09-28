/**
 * Applies a `git diff` (unified format) to file contents, so a build's patch can become a commit
 * through the GitHub API. Strict: context and removed lines must match exactly; binary changes,
 * renames and mode-only changes are refused rather than guessed.
 */

export type PatchLine = { op: ' ' | '-' | '+'; text: string };

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PatchLine[];
  /** "\ No newline at end of file" followed the new side's last line. */
  newNoNewline: boolean;
}

export interface FilePatch {
  path: string;
  kind: 'modify' | 'add' | 'delete';
  hunks: Hunk[];
}

export class PatchError extends Error {}

function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, '');
}

export function parsePatch(patch: string): FilePatch[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const files: FilePatch[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('diff --git ')) {
      i += 1;
      continue;
    }
    const header = lines[i];
    i += 1;
    let kind: FilePatch['kind'] = 'modify';
    let oldPath: string | null = null;
    let newPath: string | null = null;
    while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git ')) {
      const l = lines[i];
      if (l.startsWith('new file mode')) kind = 'add';
      else if (l.startsWith('deleted file mode')) kind = 'delete';
      else if (l.startsWith('rename from') || l.startsWith('rename to') || l.startsWith('copy from')) throw new PatchError(`Renames and copies are not supported (${header.slice(11)}).`);
      else if (l.startsWith('Binary files') || l.startsWith('GIT binary patch')) throw new PatchError(`Binary changes are not supported (${header.slice(11)}).`);
      else if (l.startsWith('--- ')) oldPath = l.slice(4).trim();
      else if (l.startsWith('+++ ')) newPath = l.slice(4).trim();
      i += 1;
    }
    const path = stripPrefix(kind === 'delete' ? (oldPath ?? '') : (newPath ?? ''));
    if (!oldPath || !newPath || !path || path === '/dev/null') {
      // A mode-only change has no ---/+++ lines and no content to apply.
      if (i < lines.length && lines[i].startsWith('@@')) throw new PatchError(`Malformed diff header (${header.slice(11)}).`);
      throw new PatchError(`Mode-only or empty changes are not supported (${header.slice(11)}).`);
    }
    const hunks: Hunk[] = [];
    while (i < lines.length && lines[i].startsWith('@@')) {
      const m = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!m) throw new PatchError(`Malformed hunk header in ${path}.`);
      const hunk: Hunk = {
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
        newNoNewline: false,
      };
      i += 1;
      let oldSeen = 0;
      let newSeen = 0;
      while (i < lines.length && (oldSeen < hunk.oldLines || newSeen < hunk.newLines || lines[i].startsWith('\\'))) {
        const l = lines[i];
        if (l.startsWith('\\')) {
          const last = hunk.lines[hunk.lines.length - 1];
          if (last && last.op !== '-') hunk.newNoNewline = true;
          i += 1;
          continue;
        }
        const op = l[0] as PatchLine['op'] | undefined;
        // Some tools drop the space on empty context lines.
        const line: PatchLine = op === '-' || op === '+' || op === ' ' ? { op, text: l.slice(1) } : { op: ' ', text: '' };
        if (op !== undefined && op !== '-' && op !== '+' && op !== ' ') throw new PatchError(`Unexpected line in ${path} hunk.`);
        if (line.op !== '+') oldSeen += 1;
        if (line.op !== '-') newSeen += 1;
        hunk.lines.push(line);
        i += 1;
      }
      if (oldSeen !== hunk.oldLines || newSeen !== hunk.newLines) throw new PatchError(`Hunk line counts do not match in ${path}.`);
      hunks.push(hunk);
    }
    files.push({ path, kind, hunks });
  }
  return files;
}

/** Applies one file's hunks to its original content (null for a new file). Returns null when the file is deleted. */
export function applyFilePatch(original: string | null, file: FilePatch): string | null {
  if (file.kind === 'delete') return null;
  if (file.kind === 'add' && original !== null) throw new PatchError(`${file.path} already exists.`);
  if (file.kind === 'modify' && original === null) throw new PatchError(`${file.path} does not exist at the base commit.`);
  const source = (original ?? '').replace(/\r\n/g, '\n');
  const hadTrailingNewline = source === '' || source.endsWith('\n');
  const oldLines = source === '' ? [] : (hadTrailingNewline ? source.slice(0, -1) : source).split('\n');

  const out: string[] = [];
  let cursor = 0; // next unread index in oldLines
  let trailingNewline = hadTrailingNewline;
  for (const hunk of file.hunks) {
    const expected = hunk.lines.filter((l) => l.op !== '+').map((l) => l.text);
    const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
    if (start < cursor) throw new PatchError(`Overlapping hunks in ${file.path}.`);
    const matches = expected.every((text, k) => oldLines[start + k] === text);
    if (!matches) throw new PatchError(`${file.path} has changed since the build's base commit; the patch no longer applies.`);
    out.push(...oldLines.slice(cursor, start));
    for (const l of hunk.lines) if (l.op !== '-') out.push(l.text);
    cursor = start + expected.length;
    if (cursor >= oldLines.length) trailingNewline = !hunk.newNoNewline;
  }
  out.push(...oldLines.slice(cursor));
  if (out.length === 0) return '';
  return out.join('\n') + (trailingNewline ? '\n' : '');
}
