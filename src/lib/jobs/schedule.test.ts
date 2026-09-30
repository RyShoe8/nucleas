import { describe, expect, it } from 'vitest';
import { nextScheduledAt } from './schedule';

describe('nextScheduledAt', () => {
  it('uses the saved local timezone', () => {
    expect(nextScheduledAt({ kind: 'daily', time: '09:00', timezone: 'America/Chicago' }, new Date('2026-09-30T12:00:00Z'))?.toISOString()).toBe('2026-09-30T14:00:00.000Z');
  });

  it('moves to the next day after the local time has passed', () => {
    expect(nextScheduledAt({ kind: 'daily', time: '09:00', timezone: 'America/Chicago' }, new Date('2026-09-30T15:00:00Z'))?.toISOString()).toBe('2026-10-01T14:00:00.000Z');
  });

  it('honors weekly and monthly dates', () => {
    expect(nextScheduledAt({ kind: 'weekly', time: '10:30', timezone: 'UTC', weekday: 1 }, new Date('2026-09-30T00:00:00Z'))?.toISOString()).toBe('2026-10-05T10:30:00.000Z');
    expect(nextScheduledAt({ kind: 'monthly', time: '08:00', timezone: 'UTC', dayOfMonth: 3 }, new Date('2026-09-30T00:00:00Z'))?.toISOString()).toBe('2026-10-03T08:00:00.000Z');
  });

  it('returns null for one-time work', () => {
    expect(nextScheduledAt({ kind: 'once' }, new Date())).toBeNull();
  });
});
