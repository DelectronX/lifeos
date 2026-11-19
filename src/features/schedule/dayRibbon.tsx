import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TRACKER_PALETTE } from '@/config/trackers';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/date';
import type { ScheduleBlock, Tracker, TrackerColor } from '@/types';

/** Hex for a tracker colour name (falls back to the accent). */
export function trackerHex(color: TrackerColor | string | undefined): string {
  return (color && TRACKER_PALETTE[color as TrackerColor]?.hex) || '#0A84FF';
}

const HOUR = 3_600_000;

/**
 * Day Ribbon — LifeOS's signature view. The whole waking day as one
 * continuous timeline of the user's real blocks, coloured by area:
 *   completed  → solid
 *   upcoming   → soft tint
 *   missed / skipped → hatched outline
 *   running    → solid with a glow
 * plus a live "now" needle. Tapping a segment opens the schedule.
 */
export function DayRibbon({
  blocks, trackers, now, className,
}: {
  blocks: readonly ScheduleBlock[];
  trackers: Record<string, Tracker>;
  now: number;
  className?: string;
}) {
  const navigate = useNavigate();
  const items = useMemo(
    () => blocks.filter((b) => b.status !== 'cancelled' && b.kind !== 'sleep').sort((a, b) => a.start - b.start),
    [blocks],
  );

  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const d0 = dayStart.getTime();
  const from = items.length ? Math.floor((Math.min(...items.map((b) => b.start)) - d0) / HOUR) * HOUR + d0 : d0 + 6 * HOUR;
  const to = items.length ? Math.ceil((Math.max(...items.map((b) => b.end)) - d0) / HOUR) * HOUR + d0 : d0 + 23 * HOUR;
  const span = Math.max(HOUR, to - from);
  const pct = (t: number) => ((Math.min(Math.max(t, from), to) - from) / span) * 100;
  const nowIn = now >= from && now <= to;

  const hours: number[] = [];
  const step = span > 14 * HOUR ? 3 : 2;
  for (let t = from; t <= to; t += step * HOUR) hours.push(t);

  const done = items.filter((b) => b.status === 'completed').length;

  return (
    <div className={cn('select-none', className)}>
      <div
        className="relative h-14 overflow-hidden rounded-[var(--r-lg)] bg-surface-sunken/60"
        role="img"
        aria-label={`Today: ${done} of ${items.length} blocks done`}
      >
        {/* Elapsed-time wash */}
        {nowIn ? <div className="absolute inset-y-0 left-0 bg-white/[0.025]" style={{ width: `${pct(now)}%` }} /> : null}

        {items.map((b) => {
          const hex = trackerHex(trackers[b.trackerId]?.color);
          const running = b.start <= now && b.end > now && b.status !== 'completed' && b.status !== 'skipped';
          const past = b.end <= now;
          const missed = (past && b.status !== 'completed') || b.status === 'skipped';
          const left = pct(b.start);
          const width = Math.max(0.35, pct(b.end) - left);
          const thin = b.optional || ['break', 'meal', 'buffer'].includes(b.kind);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => navigate('/schedule')}
              title={`${b.title} · ${formatTime(b.start)}–${formatTime(b.end)}`}
              aria-label={`${b.title}, ${formatTime(b.start)} to ${formatTime(b.end)}, ${b.status}`}
              className={cn(
                'absolute rounded-[6px] transition-[filter,transform] duration-base ease-calm hover:brightness-125',
                thin ? 'top-[38%] h-[24%]' : 'top-[14%] h-[72%]',
              )}
              style={{
                left: `calc(${left}% + 1px)`,
                width: `calc(${width}% - 2px)`,
                backgroundColor: b.status === 'completed' || running ? hex : missed ? 'transparent' : `${hex}40`,
                boxShadow: missed ? `inset 0 0 0 1.5px ${hex}80` : running ? `0 0 18px -2px ${hex}` : undefined,
                backgroundImage: missed
                  ? `repeating-linear-gradient(135deg, ${hex}38 0 3px, transparent 3px 7px)`
                  : undefined,
              }}
            />
          );
        })}

        {nowIn ? (
          <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pct(now)}%` }}>
            <div className="absolute inset-y-1 -ml-px w-[2px] rounded-full bg-ink shadow-[0_0_8px_rgb(var(--c-ink)/0.6)]" />
            <div className="absolute -ml-[5px] top-0.5 h-2.5 w-2.5 rounded-full bg-ink" />
          </div>
        ) : null}
      </div>

      <div className="relative mt-1.5 h-4">
        {hours.map((t) => (
          <span key={t} className="t-num absolute -translate-x-1/2 text-[0.6875rem] text-ink-faint first:translate-x-0 last:-translate-x-full" style={{ left: `${pct(t)}%` }}>
            {new Date(t).toLocaleTimeString(undefined, { hour: 'numeric' })}
          </span>
        ))}
      </div>
    </div>
  );
}
