/** "now", "4m", "2h", "Tue", "12 Nov" — compact, like iOS notification times. */
export function relativeTime(at: number, now = Date.now()): string {
  const d = Math.max(0, now - at);
  if (d < 60_000) return 'now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  const date = new Date(at);
  if (d < 6 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
