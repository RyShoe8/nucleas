import { describe, expect, it } from 'vitest';
import { currentEvidence, evidenceFromFindings, type BoardEvidence } from './teamBoard';

const now = new Date('2026-11-25T15:00:00Z');
const row: BoardEvidence = { fact: 'Alpha advertises withdrawals in 24 hours.', url: 'https://example.com/terms', member: 'marketing', at: now.toISOString(), checkedAt: now.toISOString(), quote: 'Withdrawals in 24 hours.', subject: 'Alpha', scope: 'Advertised withdrawal timing', status: 'supported' };
describe('team evidence memory', () => {
  it('does not collapse different claims from the same page', () => {
    expect(evidenceFromFindings('- Alpha has a withdrawal fee. [Terms](https://example.com/terms)\n- Approval must happen first. [Terms](https://example.com/terms)')).toHaveLength(2);
  });
  it('treats historical linked bullets as unverified', () => {
    expect(currentEvidence([{ ...row, status: undefined, quote: undefined }], now)[0].status).toBe('unverified');
  });
  it('keeps contradictory revisions visible instead of declaring the newest correct', () => {
    expect(currentEvidence([{ ...row, fact: 'Alpha advertises withdrawals in 48 hours.' }, row], now).every(r => r.status === 'conflicted')).toBe(true);
  });
  it('demotes stale facts without changing their original verification timestamp', () => {
    const old = { ...row, checkedAt: '2026-10-01T00:00:00Z' };
    expect(currentEvidence([old], now)[0]).toMatchObject({ checkedAt: old.checkedAt, status: 'unverified' });
  });
});
