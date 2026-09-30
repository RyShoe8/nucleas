/**
 * The object a line of code belongs to, worked out from the brackets around it. A small model that sees
 * `slug: "openhv"` will invent the structure around it (a nested `editions` array that does not exist);
 * saying "this line is one field of an object with gameSlug: "openra", directly inside `export const
 * editions = [`" leaves nothing to invent.
 */

const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const blank = (line: string) => line.replace(STRING, '""').replace(/\/\/.*$/, '');
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export interface EntryFacts {
  start: number;
  end: number;
  /** key: value pairs at the top level of the object (values shortened). */
  fields: { key: string; value: string }[];
  /** The line that opens the bracket the object sits directly inside, e.g. `export const editions = [`. */
  container?: { line: number; text: string };
}

export function enclosingEntry(content: string, line: number): EntryFacts | null {
  const lines = content.split('\n');
  const at = line - 1;
  if (at < 0 || at >= lines.length) return null;
  // Walk up collecting the unmatched opening brackets: the first `{` is the object, the next one its container.
  const open: { index: number; char: string }[] = [];
  let depth = 0;
  for (let j = at; j >= 0 && at - j <= 120 && open.length < 2; j -= 1) {
    const text = blank(lines[j]);
    for (let c = text.length - 1; c >= 0; c -= 1) {
      const ch = text[c];
      if (ch === '}' || ch === ']') depth += 1;
      else if (ch === '{' || ch === '[') {
        if (depth === 0) {
          // On the line itself, brackets after the quote do not enclose it; only openers count once found upward.
          open.push({ index: j, char: ch });
          if (open.length === 2 || (open[0].char === '{' && open.length === 1 && false)) break;
        } else depth -= 1;
      }
    }
  }
  const entryAt = open.findIndex((o) => o.char === '{');
  if (entryAt < 0) {
    // An object written on one line: { parent: 'widget', slug: 'gadgetPro' },
    const inline = /\{([^{}]*)\}/.exec(lines[at]);
    if (!inline) return null;
    const fields: EntryFacts['fields'] = [];
    for (const m of inline[1].matchAll(/["']?([A-Za-z_]\w*)["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+)/g)) if (fields.length < 8) fields.push({ key: m[1], value: clip(m[2].trim(), 50) });
    const container = open.find((o) => o.char === '[');
    return { start: at + 1, end: at + 1, fields, ...(container ? { container: { line: container.index + 1, text: clip(lines[container.index].trim(), 100) } } : {}) };
  }
  const start = open[entryAt].index;
  const container = open[entryAt + 1];
  // Forward to the matching close.
  let d = 0;
  let end = start;
  const fields: EntryFacts['fields'] = [];
  for (let j = start; j < lines.length && j - start <= 150; j += 1) {
    const text = blank(lines[j]);
    const before = d;
    for (const ch of text) {
      if (ch === '{' || ch === '[') d += 1;
      else if (ch === '}' || ch === ']') d -= 1;
    }
    end = j;
    // A field is on a line that starts at the object's own depth (1) and is not itself a bracket line's tail.
    if (before === 1 || (j === start && before === 0 && /\{\s*\S/.test(text))) {
      const whole = j === start ? lines[j].slice(lines[j].indexOf('{') + 1) : lines[j];
      const cut = whole.search(/[{[]/);
      const src = cut >= 0 ? whole.slice(0, cut + 1) : whole;
      for (const m of src.matchAll(/(?:^\s*|[,{]\s*)["']?([A-Za-z_]\w*)["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,{}\[\]]+)?/g)) {
        if (fields.length < 8) fields.push({ key: m[1], value: clip((m[2] ?? '…').trim(), 50) });
      }
    }
    if (d <= 0) break;
  }
  return {
    start: start + 1,
    end: end + 1,
    fields,
    ...(container ? { container: { line: container.index + 1, text: clip(lines[container.index].trim(), 100) } } : {}),
  };
}

/** One sentence of facts about the object a line belongs to. */
export function describeEntry(file: string, line: number, content: string): string | null {
  const entry = enclosingEntry(content, line);
  if (!entry) return null;
  const fields = entry.fields.map((f) => `${f.key}: ${f.value}`).join(', ');
  return `${file}:${line} is inside one object (lines ${entry.start}-${entry.end}) with fields ${fields || '(none found)'}${entry.container ? `, which sits directly inside \`${entry.container.text}\` (line ${entry.container.line})` : ''}. No other structure around it is known.`;
}

/** Numbered lines around `line` (the line itself marked with >), so a quote can be read in the entry it belongs to. */
export function contextAround(content: string, line: number, radius = 5): string {
  const lines = content.split('\n');
  const from = Math.max(1, line - radius);
  const to = Math.min(lines.length, line + radius);
  return lines.slice(from - 1, to).map((text, i) => `${from + i}${from + i === line ? '>' : ' '} ${text.length > 140 ? `${text.slice(0, 140)}\u2026` : text}`).join('\n');
}

