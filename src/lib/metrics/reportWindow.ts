/** Inclusive provider reporting dates. Do not reinterpret them as individual event timestamps. */
export function reportWindow(start: string | null, end: string | null, now = new Date()) {
    if (!start && !end) return null;
    const parse = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!parse(start) || !parse(end)) throw Error('Choose valid start and end dates.');
    const days = (Date.parse(end!) - Date.parse(start!)) / 86_400_000 + 1;
    if (days < 1 || days > 90 || end! >= now.toISOString().slice(0, 10)) throw Error('Choose 1–90 completed reporting days.');
    return { periodDays: days, through: end! };
}
