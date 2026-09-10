import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/date';
import type { PomodoroPhase, TimerMode } from '@/types';

export const MODE_LABELS: Record<TimerMode, string> = {
  focus: 'Focus',
  pomodoro: 'Pomodoro',
  stopwatch: 'Stopwatch',
  countdown: 'Countdown',
  paper: 'Paper',
  question: 'Question',
};

export const PHASE_LABELS: Record<PomodoroPhase, string> = {
  work: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break',
};

/**
 * The big clock. A progress ring is only drawn when the run has a real target
 * (countdown, pomodoro phase, focus-with-target) — an open-ended stopwatch has
 * nothing to be a fraction of, so it renders as plain time.
 */
export function TimerDial({
  primaryMs, progress, caption, phase, running, size = 'lg', overtime,
}: {
  primaryMs: number;
  /** 0..1, or null for open-ended runs. */
  progress: number | null;
  caption?: string;
  phase?: PomodoroPhase;
  running: boolean;
  size?: 'md' | 'lg';
  overtime?: boolean;
}) {
  const px = size === 'lg' ? 236 : 168;
  const stroke = size === 'lg' ? 10 : 8;
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = progress === null ? 0 : Math.max(0, Math.min(1, progress));
  const isBreak = phase && phase !== 'work';

  return (
    <div className="relative mx-auto flex items-center justify-center" style={{ width: px, height: px }}>
      {progress !== null ? (
        <svg width={px} height={px} className="-rotate-90" aria-hidden>
          <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke="rgb(var(--c-line))" strokeWidth={stroke} />
          <circle
            cx={px / 2} cy={px / 2} r={r} fill="none"
            stroke={overtime ? 'rgb(var(--c-caution))' : isBreak ? 'rgb(var(--c-positive))' : 'rgb(var(--c-accent))'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)' }}
          />
        </svg>
      ) : (
        <div className="absolute inset-0 rounded-full border border-dashed border-line" />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          className={cn(
            't-num font-semibold tabular-nums tracking-[-0.03em]',
            size === 'lg' ? 'text-[2.75rem] leading-none sm:text-[3.25rem]' : 'text-3xl leading-none',
            overtime ? 'text-caution' : 'text-ink',
          )}
        >
          {formatClock(primaryMs)}
        </div>
        {caption ? <div className="t-meta mt-2 text-center">{caption}</div> : null}
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              running ? (isBreak ? 'bg-positive' : 'bg-accent') : 'bg-ink-faint',
              running && 'animate-pulse',
            )}
          />
          <span className="t-meta">{running ? 'Running' : 'Paused'}</span>
        </div>
      </div>
    </div>
  );
}
