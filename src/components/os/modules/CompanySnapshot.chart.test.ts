import { describe, expect, it } from 'vitest';
import { dayTicks } from './CompanySnapshot';

const day = (iso: string) => Date.parse(iso + 'T00:00:00Z');

describe('day markers under a company chart', () => {
  it('marks every day of a week and names each one', () => {
    const ticks = dayTicks(day('2026-11-03'), day('2026-11-09'));
    expect(ticks).toHaveLength(7);
    expect(ticks.every((tick) => tick.major)).toBe(true);
    expect(ticks[0]!.label).toMatch(/3/);
    expect(ticks.at(-1)!.label).toMatch(/9/);
  });

  it('marks every day but labels fewer over a longer range, always with the first and last day', () => {
    for (const [start, end, days] of [['2026-10-27', '2026-11-09', 14], ['2026-10-13', '2026-11-09', 28], ['2026-08-12', '2026-11-09', 90]] as const) {
      const ticks = dayTicks(day(start), day(end));
      expect(ticks).toHaveLength(days);
      const labelled = ticks.filter((tick) => tick.major);
      expect(labelled.length).toBeGreaterThanOrEqual(3);
      expect(labelled.length).toBeLessThanOrEqual(8);
      expect(ticks[0]!.major && ticks.at(-1)!.major).toBe(true);
    }
  });

  it('copes with a single day', () => {
    expect(dayTicks(day('2026-11-09'), day('2026-11-09'))).toHaveLength(1);
  });
});
