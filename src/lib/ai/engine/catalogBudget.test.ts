import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { contextWindowFromProviderMessage, contextBudgetChars, outputBudgetTokens } from './catalog';

describe('model context budgeting', () => {
  it('learns the exact LiteLLM deployment limit from a context rejection', () => {
    const tokens = contextWindowFromProviderMessage("This model's maximum context length is 9216 tokens. However, you requested 4000 output tokens.");
    expect(tokens).toBe(9216);
    const output = outputBudgetTokens(tokens!, 3000);
    expect(output).toBe(2304);
    expect(contextBudgetChars(tokens!, output)).toBeLessThan(15_000);
  });

  it('ignores unrelated and implausible provider messages', () => {
    expect(contextWindowFromProviderMessage('Internal server error')).toBeNull();
    expect(contextWindowFromProviderMessage('maximum context length is 12 tokens')).toBeNull();
  });
});
