import type { DateKey, MinuteOfDay, Timestamp } from '@/types';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Local calendar day key for a timestamp or Date. Always local, never UTC. */
export function toDateKey(input: Timestamp | Date): DateKey {
  const d = typeof input === 'number' ? new Date(input) : input;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight timestamp for a date key. */
export function dateKeyToTimestamp(key: DateKey): Timestamp {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
}

export function dateKeyToDate(key: DateKey): Date {
  return new Date(dateKeyToTimestamp(key));
}

export function todayKey(now: Timestamp = Date.now()): DateKey {
  return toDateKey(now);
}

export function addDaysToKey(key: DateKey, days: number): DateKey {
  const d = dateKeyToDate(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Whole calendar days between two keys (b - a). */
export function diffDays(a: DateKey, b: DateKey): number {
  const ms = dateKeyToTimestamp(b) - dateKeyToTimestamp(a);
  return Math.round(ms / DAY_MS);
}

export function startOfDay(ts: Timestamp): Timestamp {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: Timestamp): Timestamp {
  return startOfDay(ts) + DAY_MS - 1;
}

/** Minutes elapsed since local midnight of the day containing `ts`. */
export function minuteOfDay(ts: Timestamp): MinuteOfDay {
  return Math.floor((ts - startOfDay(ts)) / MINUTE_MS);
}

/** Absolute timestamp for a minute offset within a given date key. */
export function atMinute(key: DateKey, minute: MinuteOfDay): Timestamp {
  return dateKeyToTimestamp(key) + minute * MINUTE_MS;
}

export function startOfWeekKey(key: DateKey, weekStartsOn: 0 | 1 = 1): DateKey {
  const d = dateKeyToDate(key);
  const day = d.getDay();
  const delta = (day - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - delta);
  return toDateKey(d);
}

export function weekKeys(startKey: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(startKey, i));
}

export function monthKey(key: DateKey): string {
  return key.slice(0, 7);
}

/** ISO-8601 week key, e.g. 2026-W12. */
export function isoWeekKey(key: DateKey): string {
  const d = dateKeyToDate(key);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNum + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${target.getFullYear()}-W${pad(week)}`;
}

/** "9:30 AM" style label from a minute-of-day. */
export function formatMinute(minute: MinuteOfDay, use24h = false): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (use24h) return `${pad(h)}:${pad(mm)}`;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(mm)} ${suffix}`;
}

export function formatTime(ts: Timestamp, use24h = false): string {
  return formatMinute(minuteOfDay(ts), use24h);
}

export function formatTimeRange(start: Timestamp, end: Timestamp, use24h = false): string {
  return `${formatTime(start, use24h)} - ${formatTime(end, use24h)}`;
}

/** "1h 25m", "45m", "0m" */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatDurationMs(ms: number): string {
  return formatDuration(ms / MINUTE_MS);
}

/** "01:23:45" / "23:45" clock display for timers. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function weekdayName(dayOfWeek: number, short = false): string {
  return (short ? WEEKDAY_SHORT : WEEKDAY_LONG)[((dayOfWeek % 7) + 7) % 7];
}

export function monthName(monthIndex: number, short = true): string {
  return (short ? MONTH_SHORT : MONTH_LONG)[((monthIndex % 12) + 12) % 12];
}

/** "Mon, 7 Sep" */
export function formatDateKeyShort(key: DateKey): string {
  const d = dateKeyToDate(key);
  return `${weekdayName(d.getDay(), true)}, ${d.getDate()} ${monthName(d.getMonth())}`;
}

/** "Monday, 7 September 2026" */
export function formatDateKeyLong(key: DateKey): string {
  const d = dateKeyToDate(key);
  return `${weekdayName(d.getDay())}, ${d.getDate()} ${monthName(d.getMonth(), false)} ${d.getFullYear()}`;
}

/** Today / Tomorrow / Yesterday / short date, relative to `ref`. */
export function relativeDayLabel(key: DateKey, ref: DateKey = todayKey()): string {
  const delta = diffDays(ref, key);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta < 7) return weekdayName(dateKeyToDate(key).getDay());
  return formatDateKeyShort(key);
}

/** "in 3 days" / "2 days overdue" / "due today". */
export function dueLabel(key: DateKey, ref: DateKey = todayKey()): string {
  const delta = diffDays(ref, key);
  if (delta === 0) return 'Due today';
  if (delta === 1) return 'Due tomorrow';
  if (delta === -1) return '1 day overdue';
  if (delta < 0) return `${Math.abs(delta)} days overdue`;
  return `Due in ${delta} days`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds a timestamp down to the nearest `minutes` grid step. */
export function snapToGrid(ts: Timestamp, minutes: number): Timestamp {
  const step = minutes * MINUTE_MS;
  return Math.round(ts / step) * step;
}

export function snapUp(ts: Timestamp, minutes: number): Timestamp {
  const step = minutes * MINUTE_MS;
  return Math.ceil(ts / step) * step;
}

/** Inclusive list of date keys from `from` to `to`. */
export function dateKeyRange(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 5000) {
    out.push(cur);
    cur = addDaysToKey(cur, 1);
  }
  return out;
}
