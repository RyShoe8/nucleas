/** Curated IANA timezones for scheduling UIs (US-heavy + common global). */
const COMMON_TIMEZONE_VALUES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Athens',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const;

export type TimezoneOption = { value: string; label: string };

function formatTimezoneLabel(timeZone: string): string {
  const name = timeZone.replace(/_/g, ' ');
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value;
    return offset ? `${name} (${offset})` : name;
  } catch {
    return name;
  }
}

/** Options for a timezone select; includes current value if not in the common list. */
export function getTimezoneSelectOptions(currentValue?: string): TimezoneOption[] {
  const values = new Set<string>(COMMON_TIMEZONE_VALUES);
  const ordered: string[] = [...COMMON_TIMEZONE_VALUES];
  const trimmed = currentValue?.trim();
  if (trimmed && !values.has(trimmed)) {
    ordered.unshift(trimmed);
  }
  return ordered.map((value) => ({
    value,
    label: formatTimezoneLabel(value),
  }));
}
