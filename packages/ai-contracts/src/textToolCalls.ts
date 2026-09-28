/**
 * Reading tool calls that a model wrote as text. Used by the gateway and the execution worker, so
 * it has no imports.
 */

export type TextToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

/** Python-style keyword arguments: name="x", days=7, flag=true. Null when anything else is in there. */
function parseKeywordArgs(source: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const re = /([A-Za-z_]\w*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false|True|False|None|null)\s*(?:,|$)/g;
  let consumed = '';
  for (const m of source.matchAll(re)) {
    const raw = m[2];
    out[m[1]] = raw.startsWith('"')
      ? JSON.parse(raw)
      : raw.startsWith("'")
        ? raw.slice(1, -1).replace(/\\'/g, "'")
        : /^(true|True)$/.test(raw)
          ? true
          : /^(false|False)$/.test(raw)
            ? false
            : /^(None|null)$/.test(raw)
              ? null
              : Number(raw);
    consumed += m[0];
  }
  return consumed.replace(/\s/g, '').length === source.replace(/\s/g, '').length ? out : null;
}

function jsonValuesIn(text: string): unknown[] {
  try {
    const whole = JSON.parse(text.trim());
    return Array.isArray(whole) ? whole : [whole];
  } catch {
    return [];
  }
}

/**
 * Tool calls a model wrote as text because its host has no tool-call parser: Qwen/Hermes
 * <tool_call>{…}</tool_call>, a fenced or bare JSON object ({"name", "arguments"|"parameters"}),
 * or Gemma-style name(key="value"). Only names of the offered tools are accepted.
 */
export function toolCallsFromText(text: string, toolNames: string[]): { calls: TextToolCall[]; rest: string } {
  const allowed = new Set(toolNames);
  const calls: TextToolCall[] = [];
  let rest = text;
  const add = (name: unknown, args: unknown): boolean => {
    if (typeof name !== 'string' || !allowed.has(name) || calls.length >= 8) return false;
    const argumentsJson = typeof args === 'string' ? args : JSON.stringify(args ?? {});
    if (name.length > 64 || argumentsJson.length > 16000) return false;
    calls.push({ id: `call_text_${calls.length}`, type: 'function', function: { name, arguments: argumentsJson } });
    return true;
  };
  const fromObject = (value: unknown): boolean => {
    const o = value as { name?: unknown; arguments?: unknown; parameters?: unknown; function?: unknown; tool_call?: unknown } | null;
    if (!o || typeof o !== 'object') return false;
    if (o.function && typeof o.function === 'object') return fromObject(o.function);
    if (o.tool_call && typeof o.tool_call === 'object') return fromObject(o.tool_call);
    return add(o.name, o.arguments ?? o.parameters ?? {});
  };
  const fromValues = (values: unknown[]) => values.map(fromObject).some(Boolean);
  const fromCallSyntax = (source: string): boolean => {
    let hit = false;
    for (const line of source.trim().split('\n')) {
      const m = line.trim().match(/^(?:print\(\s*)?([A-Za-z_]\w*)\(([\s\S]*?)\)\s*\)?;?$/);
      if (!m || !allowed.has(m[1])) continue;
      const args = m[2].trim() ? parseKeywordArgs(m[2]) : {};
      if (args && add(m[1], args)) hit = true;
    }
    return hit;
  };

  // 0. Gemma 4: <|tool_call>call:name{key:<|"|>value<|"|>,n:7}<tool_call|>, or call:name{JSON} without the tokens.
  for (const found of gemmaCalls(text)) {
    if (add(found.name, found.args)) rest = rest.replace(found.raw, '');
  }
  if (calls.length) return { calls, rest: rest.replace(/<\|?\/?tool_call\|?>/g, '').trim() };

  // 1. <tool_call>…</tool_call> blocks.
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)) {
    if (fromValues(jsonValuesIn(m[1]))) rest = rest.replace(m[0], '');
  }
  // 2. Fenced blocks: JSON, or tool_code/python calls.
  if (!calls.length) {
    for (const m of text.matchAll(/```(?:json|tool_code|tool_call|python)?\s*([\s\S]*?)```/gi)) {
      const values = jsonValuesIn(m[1]);
      if (values.length ? fromValues(values) : fromCallSyntax(m[1])) rest = rest.replace(m[0], '');
    }
  }
  // 3. The whole reply is a JSON call or bare name(args) lines.
  if (!calls.length && (fromValues(jsonValuesIn(text)) || fromCallSyntax(text))) rest = '';
  return { calls, rest: rest.trim() };
}

const GEMMA_QUOTE = '<|"|>';

/**
 * Gemma 4 call syntax: `call:name{…}` (optionally wrapped in <|tool_call> … <tool_call|>), where the
 * braces hold JSON or Gemma's own form: bare keys and strings delimited by <|"|>.
 */
function gemmaCalls(text: string): { raw: string; name: string; args: Record<string, unknown> }[] {
  const out: { raw: string; name: string; args: Record<string, unknown> }[] = [];
  const re = /(?:<\|tool_call>\s*)?call:([A-Za-z_]\w*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const close = matchingBrace(text, open);
    if (close < 0) continue;
    const body = text.slice(open, close + 1);
    const args = gemmaArgs(body);
    let end = close + 1;
    const tail = text.slice(end).match(/^\s*<tool_call\|>/);
    if (tail) end += tail[0].length;
    if (args) out.push({ raw: text.slice(m.index, end), name: m[1], args });
    re.lastIndex = end;
  }
  return out;
}

/** Index of the brace closing the one at `open`, skipping strings ("…" or <|"|>…<|"|>). */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text.startsWith(GEMMA_QUOTE, i)) {
      const endQuote = text.indexOf(GEMMA_QUOTE, i + GEMMA_QUOTE.length);
      if (endQuote < 0) return -1;
      i = endQuote + GEMMA_QUOTE.length - 1;
      continue;
    }
    const ch = text[i];
    if (ch === '"') {
      for (i += 1; i < text.length && text[i] !== '"'; i += text[i] === '\\' ? 2 : 1);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

function gemmaArgs(body: string): Record<string, unknown> | null {
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(body);
  if (direct) return direct;
  // Gemma form: turn <|"|>…<|"|> into JSON strings, then quote bare keys outside strings.
  const parts = body.split(GEMMA_QUOTE);
  if (parts.length % 2 === 0) return null;
  const rebuilt = parts
    .map((part, i) => (i % 2 === 1 ? JSON.stringify(part) : part.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')))
    .join('');
  return tryParse(rebuilt);
}
