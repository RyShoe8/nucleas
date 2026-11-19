import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { providerRefusedAccount } from './companyChat';

const status = (text: string, debugHint = '', costMicros = 0) => ({ requestId: 'r', role: 'status' as const, text, debugHint, costMicros });

describe('when another provider should take over a call', () => {
  it('takes over when the provider refused the account before doing anything', () => {
    expect(providerRefusedAccount(status('The remote model endpoint was unreachable or returned an error. Google returned HTTP 402: Your prepayment credits are depleted.', 'code=unavailable kind=http httpStatus=402'))).toBe(true);
    expect(providerRefusedAccount(status('Remote authentication was rejected.', 'code=credentials httpStatus=401'))).toBe(true);
    expect(providerRefusedAccount(status('OpenRouter returned HTTP 402: requires more credits.'))).toBe(true);
  });

  it('leaves rate limits, timeouts, answers, and calls that already cost something to the usual handling', () => {
    expect(providerRefusedAccount(status('The remote provider rate-limited this request.', 'httpStatus=429'))).toBe(false);
    expect(providerRefusedAccount(status('gpt took longer than 120 seconds to answer and was stopped.', 'kind=timeout'))).toBe(false);
    expect(providerRefusedAccount({ requestId: 'r', role: 'assistant', text: 'Your credits are fine.' })).toBe(false);
    expect(providerRefusedAccount(status('Google returned HTTP 402: credits depleted.', 'httpStatus=402', 1200))).toBe(false);
  });
});
