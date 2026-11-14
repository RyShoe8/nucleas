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
  // Some hosts put usage on the first choice, or inside a wrapping response event.
  const choice = fields(Array.isArray(root.choices) ? root.choices[0] : null);
  const usage = fields(root.usage ?? choice.usage ?? fields(root.response).usage);
  const groq = fields(fields(root.x_groq).usage);
  const google = fields(root.usageMetadata ?? root.usage_metadata);
  const billed = fields(fields(root.meta).billed_units);
  const input = count(usage.prompt_tokens, usage.promptTokens, groq.prompt_tokens, google.promptTokenCount, google.prompt_token_count, billed.input_tokens, root.prompt_eval_count);
  const base = count(usage.input_tokens, usage.inputTokens);
  const output = count(usage.completion_tokens, usage.completionTokens, usage.output_tokens, usage.outputTokens, groq.completion_tokens, billed.output_tokens, root.eval_count);
  const candidates = count(google.candidatesTokenCount, google.candidates_token_count);
  const inputTokens = input ?? (base === null ? null : base + (count(usage.cache_creation_input_tokens) ?? 0) + (count(usage.cache_read_input_tokens) ?? 0));
  const outputTokens = output ?? (candidates === null ? null : candidates + (count(google.thoughtsTokenCount, google.thoughts_token_count) ?? 0));
  // A total with one side known gives the other side. A total alone cannot be split, so it stays unknown.
  const total = count(usage.total_tokens, usage.totalTokens, google.totalTokenCount, google.total_token_count);
  return {
    inputTokens: inputTokens ?? (total !== null && outputTokens !== null && total >= outputTokens ? total - outputTokens : null),
    outputTokens: outputTokens ?? (total !== null && inputTokens !== null && total >= inputTokens ? total - inputTokens : null),
  };
}

/**
 * Prompt-cache tokens, when the host reports them: read from the cache (billed at a fraction of the
 * input price) and written to it (billed above it). Both are already counted in the input tokens.
 */
export function readCacheUsage(body: unknown): { cacheReadTokens: number; cacheWriteTokens: number } {
  const root = fields(body);
  const choice = fields(Array.isArray(root.choices) ? root.choices[0] : null);
  const usage = fields(root.usage ?? choice.usage ?? fields(root.response).usage);
  const details = fields(usage.prompt_tokens_details ?? usage.input_tokens_details);
  return {
    cacheReadTokens: count(details.cached_tokens, usage.cache_read_input_tokens) ?? 0,
    cacheWriteTokens: count(details.cache_write_tokens, usage.cache_creation_input_tokens) ?? 0,
  };
}
