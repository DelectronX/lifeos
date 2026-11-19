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
  const px = size === 'lg' ? 260 : 176;
  const stroke = size === 'lg' ? 6 : 5;
  const r = (px - stroke) / 2 - (size === 'lg' ? 18 : 13); // inner progress ring, inside the bezel
  const c = 2 * Math.PI * r;
  const pct = progress === null ? 0 : Math.max(0, Math.min(1, progress));
  const isBreak = phase && phase !== 'work';
  const tone = overtime ? 'rgb(var(--c-caution))' : isBreak ? 'rgb(var(--c-positive))' : 'rgb(var(--c-accent))';
  // Bezel: 60 ticks. Bounded runs light ticks up to progress; open runs sweep a second marker.
  const lit = progress !== null ? Math.round(pct * 60) : -1;
  const sweep = progress === null ? Math.floor(primaryMs / 1000) % 60 : -1;
  const R0 = px / 2 - 2, R1 = px / 2 - (size === 'lg' ? 10 : 7), R1m = px / 2 - (size === 'lg' ? 14 : 10);

  return (
    <div className="relative mx-auto flex items-center justify-center" style={{ width: px, height: px }}>
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden>
        <g transform={`translate(${px / 2} ${px / 2})`}>
          {Array.from({ length: 60 }, (_, i) => {
            const major = i % 5 === 0;
            const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
            const on = i < lit || i === sweep;
            const rr = major ? R1m : R1;
            return (
              <line key={i}
                x1={Math.cos(a) * R0} y1={Math.sin(a) * R0} x2={Math.cos(a) * rr} y2={Math.sin(a) * rr}
                stroke={on ? tone : 'rgb(var(--c-ink))'} strokeOpacity={on ? 1 : major ? 0.28 : 0.12}
                strokeWidth={major ? 2 : 1.25} strokeLinecap="round"
                style={{ transition: 'stroke 300ms ease, stroke-opacity 300ms ease' }} />
            );
          })}
        </g>
        {progress !== null ? (
          <g transform={`rotate(-90 ${px / 2} ${px / 2})`}>
            <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke="rgb(var(--c-ink) / 0.08)" strokeWidth={stroke} />
            <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
              style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)', filter: `drop-shadow(0 0 6px ${tone})` }} />
          </g>
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          className={cn(
            't-num t-rounded font-semibold tabular-nums tracking-[-0.03em]',
            size === 'lg' ? 'text-[2.75rem] leading-none sm:text-[3.25rem]' : 'text-3xl leading-none',
            overtime ? 'text-caution' : 'text-ink',
          )}
          aria-live="off"
        >
          {formatClock(primaryMs)}
        </div>
        {caption ? <div className="t-meta mt-2 max-w-[70%] text-center">{caption}</div> : null}
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={cn('h-1.5 w-1.5 rounded-full', running ? (isBreak ? 'bg-positive' : 'bg-accent') : 'bg-ink-faint', running && 'live-dot')}
          />
          <span className="t-meta">{running ? (isBreak ? 'Break' : 'Focusing') : 'Paused'}</span>
        </div>
      </div>
    </div>
  );
}

