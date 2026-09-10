import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge, TrackerBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { TimerDial, MODE_LABELS, PHASE_LABELS } from '@/components/timer/TimerDial';
import { TimerControls } from '@/components/timer/TimerControls';
import { useTimerReading, useTimerStore } from '@/state/useTimer';
import { useTask, useTrackerMap } from '@/state/useLiveData';
import { toast } from '@/state/toastStore';
import { formatDuration, formatTime } from '@/lib/date';
import type { FinishTimerResult } from '@/services/timerService';

/**
 * The live timer. Every figure here is recomputed from wall-clock timestamps on
 * each tick, so it is correct after a refresh, a sleeping laptop or a throttled
 * background tab.
 */
export function ActiveTimerPanel() {
  const { snapshot, reading } = useTimerReading();
  const pause = useTimerStore((s) => s.pause);
  const resume = useTimerStore((s) => s.resume);
  const stop = useTimerStore((s) => s.stop);
  const advance = useTimerStore((s) => s.advance);
  const addMinutes = useTimerStore((s) => s.addMinutes);
  const trackerMap = useTrackerMap();
  const task = useTask(snapshot?.taskId ?? null);
  const [confirm, setConfirm] = useState<null | 'stop' | 'complete'>(null);

  if (!snapshot || !reading) return null;

  const tracker = trackerMap[snapshot.trackerId];
  const isCountdown = snapshot.mode === 'countdown' || (snapshot.mode === 'pomodoro');
  const target = reading.remainingMs !== null;
  // Countdown-style modes show time left; focus/stopwatch show time done.
  const primaryMs = isCountdown && reading.remainingMs !== null ? reading.remainingMs : reading.phaseMs;
  const overtime = snapshot.mode === 'focus' && reading.phaseComplete;

  const finish = async (completeTask: boolean) => {
    const result = await stop({ completed: true, completeTask });
    setConfirm(null);
    report(result);
  };

  const abandon = async () => {
    const result = await stop({ completed: false });
    setConfirm(null);
    report(result, 'Session stopped');
  };

  const report = (result: FinishTimerResult | null, title = 'Session recorded') => {
    if (!result) {
      toast.show('Nothing recorded', 'The session was too short to log.');
      return;
    }
    const minutes = Math.round(result.session.workMs / 60_000);
    const xp = result.xpAwarded > 0 ? ` · +${result.xpAwarded} XP` : '';
    toast.success(title, `${formatDuration(minutes)} tracked${xp}${result.xpNote ? ` — ${result.xpNote}` : ''}`);
    if (result.levelUp) toast.success(`Level ${result.level}`, 'You levelled up.');
  };

  const caption = (() => {
    if (snapshot.mode === 'pomodoro') {
      return `${PHASE_LABELS[snapshot.phase]} · ${snapshot.pomodoroCount} completed`;
    }
    if (overtime) return `Target ${formatDuration((snapshot.plannedMs ?? 0) / 60_000)} passed`;
    if (snapshot.mode === 'focus' && snapshot.plannedMs) {
      return `Target ${formatDuration(snapshot.plannedMs / 60_000)}`;
    }
    if (snapshot.mode === 'stopwatch') return 'Counting up';
    return undefined;
  })();

  return (
    <>
      <Card className="relative overflow-hidden">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="accent">{MODE_LABELS[snapshot.mode]}</Badge>
          {tracker ? <TrackerBadge color={tracker.color} name={tracker.name} /> : null}
          {snapshot.interruptions > 0 ? (
            <Badge tone="neutral">{snapshot.interruptions} pause{snapshot.interruptions === 1 ? '' : 's'}</Badge>
          ) : null}
          <span className="t-meta ml-auto">Started {formatTime(snapshot.startedAt)}</span>
        </div>

        <div className="mb-1 text-center">
          <div className="t-title truncate">{snapshot.label}</div>
          {task ? (
            <Link to="/tasks" className="t-meta hover:text-ink">
              {task.title} · {formatDuration(task.actualMinutes)} of {formatDuration(task.estimatedMinutes)} done
            </Link>
          ) : null}
        </div>

        <div className="my-5">
          <TimerDial
            primaryMs={primaryMs}
            progress={target ? reading.progress : null}
            caption={caption}
            phase={snapshot.phase}
            running={reading.state === 'running'}
            overtime={overtime}
          />
        </div>

        <div className="mb-5 grid grid-cols-3 gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2.5 text-center">
          <Metric label="Work" value={formatDuration(reading.workMs / 60_000)} />
          <Metric label="Break" value={formatDuration(reading.breakMs / 60_000)} />
          <Metric
            label={snapshot.mode === 'pomodoro' ? 'Pomodoros' : 'Elapsed'}
            value={snapshot.mode === 'pomodoro' ? String(snapshot.pomodoroCount) : formatDuration(reading.elapsedMs / 60_000)}
          />
        </div>

        <TimerControls
          running={reading.state === 'running'}
          onPause={pause}
          onResume={resume}
          onStop={() => setConfirm('stop')}
          onComplete={() => setConfirm('complete')}
          onSkipPhase={snapshot.mode === 'pomodoro' ? () => advance(true) : undefined}
        />

        {snapshot.plannedMs !== null && snapshot.mode !== 'pomodoro' ? (
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button size="xs" variant="subtle" iconLeft={<Minus className="h-3 w-3" />} onClick={() => addMinutes(-5)}>
              5 min
            </Button>
            <span className="t-meta">Adjust target</span>
            <Button size="xs" variant="subtle" iconLeft={<Plus className="h-3 w-3" />} onClick={() => addMinutes(5)}>
              5 min
            </Button>
          </div>
        ) : null}
      </Card>

      <ConfirmDialog
        open={confirm === 'stop'}
        onClose={() => setConfirm(null)}
        onConfirm={() => void abandon()}
        title="Stop this session?"
        confirmLabel="Stop and record"
        message={`${formatDuration(reading.workMs / 60_000)} of work will be recorded against ${
          task ? task.title : tracker?.name ?? 'this tracker'
        }.`}
      />
      <ConfirmDialog
        open={confirm === 'complete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => void finish(!!task)}
        title="Finish session"
        confirmLabel={task ? 'Finish and complete task' : 'Finish session'}
        message={
          task
            ? `Records ${formatDuration(reading.workMs / 60_000)} and marks "${task.title}" complete.`
            : `Records ${formatDuration(reading.workMs / 60_000)} of tracked work.`
        }
      />
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="t-label">{label}</div>
      <div className="t-num mt-0.5 text-sm font-medium text-ink">{value}</div>
    </div>
  );
}
