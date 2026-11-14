import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { withCachePricing } from './companyChat';

describe('pricing prompt-cache tokens', () => {
  it('charges a tenth for tokens read from the cache and a quarter more for tokens written to it', () => {
    // $2 per million input: 1M tokens read saves $1.80, 1M written adds $0.50.
    expect(withCachePricing(5_000_000, 2_000_000, { readTokens: 1_000_000, writeTokens: 0 })).toBe(3_200_000);
    expect(withCachePricing(5_000_000, 2_000_000, { readTokens: 0, writeTokens: 1_000_000 })).toBe(5_500_000);
    expect(withCachePricing(100, 2_000_000, { readTokens: 1_000_000, writeTokens: 0 })).toBe(0);
  });
});
