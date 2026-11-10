/** Calendar dates are source reporting dates, not browser-local timestamps. */
export function periodDates(days: number, now: Date, timezone = 'UTC'): string[] {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const end = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - days + i);
    return date.toISOString().slice(0, 10);
  });
}

export interface PeriodCoverage {
  start: string;
  end: string;
  days: number;
  observed: number;
  previousObserved: number;
  previousStart: string;
  previousEnd: string;
}

export function summarizePeriod(rows: { date: string; value: number }[], dates: string[], days: number) {
  const byDate = new Map(rows.filter(r => Number.isFinite(r.value)).map(r => [r.date, r.value]));
  const currentDates = dates.slice(-days);
  const priorDates = dates.slice(-2 * days, -days);
  const points = (range: string[]) => range.flatMap(date => byDate.has(date) ? [{ date, value: byDate.get(date)! }] : []);
  const series = points(currentDates);
  const prior = points(priorDates);
  const current = series.reduce((sum, row) => sum + row.value, 0);
  const complete = series.length === days && prior.length === days;
  const previous = complete ? prior.reduce((sum, row) => sum + row.value, 0) : null;
  return {
    series, current, previous,
    change: previous !== null && previous > 0 ? (current - previous) / previous : null,
    lastDay: series.at(-1) ?? null,
    coverage: { start: currentDates[0], end: currentDates.at(-1)!, days, observed: series.length,
      previousObserved: prior.length, previousStart: priorDates[0], previousEnd: priorDates.at(-1)! } satisfies PeriodCoverage,
  };
}
