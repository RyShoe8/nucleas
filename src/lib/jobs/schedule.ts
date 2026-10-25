import type { JobSchedule } from './schema';

type Zoned = { year: number; month: number; day: number; weekday: number; hour: number; minute: number };

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function validTimezone(value: string | undefined): string {
  const timezone = value?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return 'UTC';
  }
}

function zonedParts(date: Date, timezone: string): Zoned {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY[get('weekday')] ?? 0,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** Converts a wall-clock time to UTC, including DST, by correcting an initial UTC guess twice. */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let i = 0; i < 2; i += 1) {
    const actual = zonedParts(new Date(candidate), timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    candidate += desired - represented;
  }
  return new Date(candidate);
}

/** Next occurrence strictly after `after`. Repeating job schedules are evaluated in their saved timezone. */
export function nextScheduledAt(schedule: JobSchedule, after: Date, random: () => number = Math.random): Date | null {
  if (schedule.kind === 'once') return null;
  if (schedule.kind === 'hourly') return new Date(after.getTime() + 3_600_000);
  const timezone = validTimezone(schedule.timezone);
  const [hour, minute] = (schedule.time ?? '09:00').split(':').map(Number);
  const local = zonedParts(after, timezone);
  const localNoon = new Date(Date.UTC(local.year, local.month - 1, local.day, 12));

  for (let offset = 0; offset <= 370; offset += 1) {
    // A randomized cycle is sampled once and persisted as nextRunAt. Never draw again on the same date.
    if (schedule.randomWindow && offset === 0) continue;
    const date = new Date(localNoon.getTime() + offset * 86_400_000);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const weekday = date.getUTCDay();
    if (schedule.kind === 'daily' && schedule.everyDays && schedule.everyDays > 1) {
      const anchor = schedule.anchorDate ? Date.parse(`${schedule.anchorDate}T12:00:00Z`) : Date.UTC(1970, 0, 1, 12);
      if (Math.round((date.getTime() - anchor) / 86_400_000) % schedule.everyDays !== 0) continue;
    }
    if (schedule.kind === 'weekly' && weekday !== (schedule.weekday ?? 1)) continue;
    if (schedule.kind === 'monthly' && day !== (schedule.dayOfMonth ?? 1)) continue;
    const window = schedule.randomWindow;
    // Match the ten-minute scheduler slots, including the end of the allowed window.
    const chosenMinute = window ? window.startHour * 60 + Math.floor(Math.min(0.999999999, Math.max(0, random())) * ((window.endHour - window.startHour) * 6 + 1)) * 10 : hour * 60 + minute;
    const candidate = zonedToUtc(year, month, day, Math.floor(chosenMinute / 60), chosenMinute % 60, timezone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}
