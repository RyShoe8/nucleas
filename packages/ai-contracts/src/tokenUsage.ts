function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function count(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

export function readTokenUsage(body: unknown) {
  const root = fields(body);
  const usage = fields(root.usage);
  const groq = fields(fields(root.x_groq).usage);
  const google = fields(root.usageMetadata);
  const input = count(usage.prompt_tokens, groq.prompt_tokens, google.promptTokenCount, root.prompt_eval_count);
  const base = count(usage.input_tokens);
  const output = count(usage.completion_tokens, usage.output_tokens, groq.completion_tokens, root.eval_count);
  const candidates = count(google.candidatesTokenCount);
  return {
    inputTokens: input ?? (base === null ? null : base + (count(usage.cache_creation_input_tokens) ?? 0) + (count(usage.cache_read_input_tokens) ?? 0)),
    outputTokens: output ?? (candidates === null ? null : candidates + (count(google.thoughtsTokenCount) ?? 0)),
  };
}
