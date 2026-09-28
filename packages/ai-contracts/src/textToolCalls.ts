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
