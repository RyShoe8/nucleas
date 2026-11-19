export type RecurrencePreset = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type RecurrenceEnd = 'never' | 'on' | 'after';

const WEEKDAY_BY_DAY: Record<number, string> = {
  0: 'SU',
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
};

export type BuildRecurrenceOptions = {
  preset: RecurrencePreset;
  start: Date;
  end?: RecurrenceEnd;
  until?: Date;
  count?: number;
};

/** Format date as RRULE UNTIL (UTC compact). */
function formatRruleUntil(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

export function validateRecurrenceInput(options: BuildRecurrenceOptions): string | null {
  const { preset, start, end = 'never', until, count } = options;
  if (preset === 'none') return null;
  if (end === 'on') {
    if (!until || isNaN(until.getTime())) return 'End date is required.';
    if (until.getTime() < start.getTime()) return 'End date must be on or after the meeting start.';
  }
  if (end === 'after') {
    if (count == null || !Number.isFinite(count) || count < 1) return 'Number of occurrences must be at least 1.';
    if (count > 365) return 'Number of occurrences cannot exceed 365.';
  }
  return null;
}

/** Build Google Calendar `recurrence` array (RFC 5545 RRULE lines). */
export function buildRecurrenceRule(options: BuildRecurrenceOptions): string[] {
  const { preset, start, end = 'never', until, count } = options;
  if (preset === 'none') return [];

  const err = validateRecurrenceInput(options);
  if (err) throw new Error(err);

  let rule = 'RRULE:';
  switch (preset) {
    case 'daily':
      rule += 'FREQ=DAILY';
      break;
    case 'weekly': {
      const byday = WEEKDAY_BY_DAY[start.getDay()];
      rule += `FREQ=WEEKLY;BYDAY=${byday}`;
      break;
    }
    case 'biweekly': {
      const byday = WEEKDAY_BY_DAY[start.getDay()];
      rule += `FREQ=WEEKLY;INTERVAL=2;BYDAY=${byday}`;
      break;
    }
    case 'monthly':
      rule += 'FREQ=MONTHLY';
      break;
    default:
      return [];
  }

  if (end === 'on' && until) {
    rule += `;UNTIL=${formatRruleUntil(until)}`;
  } else if (end === 'after' && count != null) {
    rule += `;COUNT=${Math.floor(count)}`;
  }

  return [rule];
}
