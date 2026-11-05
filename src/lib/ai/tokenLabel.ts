const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en-US');

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Finished runs whose provider never reported tokens. Unknown, not zero. */
  unknownTokenRuns: number;
}

/** "12.3K tokens". A "+" means some runs did not report, so the real number is higher. */
export function tokenLabel(usage: TokenUsage): string {
  const total = usage.inputTokens + usage.outputTokens;
  if (!total) return usage.unknownTokenRuns ? 'Not reported' : '0 tokens';
  return `${compact.format(total)}${usage.unknownTokenRuns ? '+' : ''} tokens`;
}

export function tokenDetail(usage: TokenUsage): string {
  const counts = `${full.format(usage.inputTokens)} in · ${full.format(usage.outputTokens)} out`;
  return usage.unknownTokenRuns ? `${counts} · ${full.format(usage.unknownTokenRuns)} run(s) did not report tokens` : counts;
}
