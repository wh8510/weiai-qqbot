export function localDateKey(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function timezoneOffsetMinutes(timezone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

export function startOfLocalDay(timezone: string, date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const utcMidnight = Date.UTC(get('year'), get('month') - 1, get('day'));
  return utcMidnight - timezoneOffsetMinutes(timezone, new Date(utcMidnight)) * 60_000;
}

export function localTimeParts(timezone: string, date = new Date()): { hour: number; minute: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

export function parseHm(value: string, fallback: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value || fallback);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isQuietHours(timezone: string, start: string, end: string, date = new Date()): boolean {
  const { hour, minute } = localTimeParts(timezone, date);
  const current = hour * 60 + minute;
  const s = parseHm(start, '23:30');
  const e = parseHm(end, '08:00');
  if (s === e) return false;
  if (s < e) return current >= s && current < e;
  return current >= s || current < e;
}

export function minutesSince(ts: number | null | undefined): number {
  if (!ts) return Number.POSITIVE_INFINITY;
  return (Date.now() - ts) / 60_000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
