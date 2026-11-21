import { expect, it } from 'vitest';
import { reportWindow } from './reportWindow';
const now = new Date('2026-11-20T12:00:00Z');
it('uses inclusive completed reporting dates', () => {
    expect(reportWindow('2026-11-13', '2026-11-19', now)).toEqual({ periodDays: 7, through: '2026-11-19' });
    expect(reportWindow(null, null, now)).toBeNull();
});
it('rejects invalid, reversed, future, partial, and unbounded date ranges', () => {
    for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-11-19', '2026-11-18'], ['2026-11-01', '2026-11-20'], ['2026-01-01', '2026-11-19'], ['2026-11-01', null]]) expect(() => reportWindow(start, end, now)).toThrow();
});
