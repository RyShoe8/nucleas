import { describe, expect, it } from 'vitest';
import { companyChatAdmissionMessage } from '@/lib/ai/companyChatAdmission';
import { ideChatModes } from '@/lib/ide/modes';

describe('IDE mode labels', () => {
  it('offers exactly the Ask controls: Orchestrated and Direct', () => {
    expect(ideChatModes.map((item) => item.label)).toEqual(['Orchestrated', 'Direct']);
  });
});

describe('companyChatAdmissionMessage', () => {
  it('points configuration failures at Admin AI Settings and paid reservation', () => {
    const text = companyChatAdmissionMessage('configuration');
    expect(text).toMatch(/Admin → AI Settings/);
    expect(text).toMatch(/reservation/i);
  });

  it('explains shared spacing for rate_limit', () => {
    expect(companyChatAdmissionMessage('rate_limit')).toMatch(/Minimum seconds between attempts/);
  });

  it('keeps a fallback for unknown codes', () => {
    expect(companyChatAdmissionMessage('provider' as 'configuration')).toBe('Chat could not be admitted.');
  });
});
