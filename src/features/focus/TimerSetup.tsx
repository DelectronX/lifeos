import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { useOpenTasks, useTrackers, useLiveSettings } from '@/state/useLiveData';
import { useTimerStore } from '@/state/useTimer';
import { toast } from '@/state/toastStore';
import { formatDuration } from '@/lib/date';
import { requestNotificationPermission, notificationPermission } from '@/services/timerService';
import { DEFAULT_TIMER_PREFERENCES } from '@/types';
import type { ID, TimerMode } from '@/types';

const MODES: { value: TimerMode; label: string; hint: string }[] = [
  { value: 'focus', label: 'Focus', hint: 'Open-ended work toward a target you can overrun.' },
  { value: 'pomodoro', label: 'Pomodoro', hint: 'Work and break phases from your settings.' },
  { value: 'stopwatch', label: 'Stopwatch', hint: 'Counts up with no target.' },
  { value: 'countdown', label: 'Countdown', hint: 'Counts down to zero and alerts you.' },
];

const PRESETS = [15, 25, 45, 60, 90];

/**
 * Start panel. Choosing a task pre-selects its tracker and target duration, so
 * the session that gets recorded is already attributed to the right goal.
 */
export function TimerSetup() {
  const trackers = useTrackers();
  const tasks = useOpenTasks();
  const settings = useLiveSettings();
  const start = useTimerStore((s) => s.start);

  const prefs = { ...DEFAULT_TIMER_PREFERENCES, ...(settings?.timers ?? {}) };

  const [mode, setMode] = useState<TimerMode>('focus');
  const [taskId, setTaskId] = useState<ID | ''>('');
  const [trackerId, setTrackerId] = useState<ID | ''>('');
  const [minutes, setMinutes] = useState(String(prefs.defaultFocusMinutes));
  const [busy, setBusy] = useState(false);

  const selectableTrackers = useMemo(() => trackers.filter((t) => t.pillar !== 'system'), [trackers]);
  const selectedTask = tasks.find((t) => t.id === taskId) ?? null;
  const effectiveTracker =
    selectedTask?.trackerId ?? (trackerId || selectableTrackers[0]?.id || trackers[0]?.id || '');

  const target = Math.max(1, Math.round(Number(minutes) || prefs.defaultFocusMinutes));
  const needsTarget = mode === 'countdown';
  const showTarget = mode === 'focus' || mode === 'countdown';

  const onPickTask = (id: string) => {
    setTaskId(id);
    const task = tasks.find((t) => t.id === id);
    if (task) {
      setTrackerId(task.trackerId);
      const remaining = Math.max(5, task.estimatedMinutes - task.actualMinutes);
      setMinutes(String(Math.min(240, remaining)));
    }
  };

  const onStart = async () => {
    if (!effectiveTracker) { toast.error('No tracker available', 'Create a tracker first.'); return; }
    if (needsTarget && target < 1) { toast.error('Set a countdown length'); return; }
    setBusy(true);
    try {
      await start({
        mode,
        trackerId: effectiveTracker,
        taskId: taskId || null,
        targetMinutes: showTarget ? target : null,
        label: selectedTask?.title,
        pomodoro: prefs,
      });
      // Ask once, lazily — never on page load, never blocking.
      if (notificationPermission() === 'default') void requestNotificationPermission();
      toast.success('Timer started', selectedTask ? selectedTask.title : undefined);
    } catch (e) {
      toast.error('Could not start timer', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Tabs
        variant="pill"
        className="mb-4"
        value={mode}
        onChange={(v) => setMode(v)}
        items={MODES.map((m) => ({ value: m.value, label: m.label }))}
      />
      <p className="t-meta mb-4">{MODES.find((m) => m.value === mode)?.hint}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Task" hint="Time is rolled onto the task and its goal.">
          <Select value={taskId} onChange={(e) => onPickTask(e.target.value)}>
            <option value="">No task — free session</option>
            {tasks.slice(0, 300).map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tracker" hint={selectedTask ? "Taken from the task." : 'Where this time is counted.'}>
          <Select
            value={effectiveTracker}
            disabled={!!selectedTask}
            onChange={(e) => setTrackerId(e.target.value)}
          >
            {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      </div>

      {showTarget ? (
        <div className="mt-4">
          <Field label={mode === 'countdown' ? 'Countdown length' : 'Target'} hint={mode === 'focus' ? 'You can keep working past it.' : undefined}>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={1}
                max={600}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className="w-28"
              />
              <span className="t-meta">minutes</span>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <Button
                    key={p}
                    size="xs"
                    variant={String(p) === minutes ? 'primary' : 'subtle'}
                    onClick={() => setMinutes(String(p))}
                  >
                    {formatDuration(p)}
                  </Button>
                ))}
              </div>
            </div>
          </Field>
        </div>
      ) : null}

      {mode === 'pomodoro' ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-sunken px-3 py-2">
          <div className="t-meta">
            {prefs.pomodoroWorkMinutes}m work · {prefs.pomodoroShortBreakMinutes}m short break ·{' '}
            {prefs.pomodoroLongBreakMinutes}m long break every {prefs.pomodorosBeforeLongBreak} cycles.
            Change these in Settings.
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="t-meta max-w-xs">
          {selectedTask
            ? `${formatDuration(Math.max(0, selectedTask.estimatedMinutes - selectedTask.actualMinutes))} left on this task.`
            : 'Sessions are recorded whether or not a task is linked.'}
        </p>
        <Button variant="primary" size="lg" iconLeft={<Play className="h-4 w-4" />} loading={busy} onClick={onStart}>
          Start {MODES.find((m) => m.value === mode)?.label.toLowerCase()}
        </Button>
      </div>
    </Card>
  );
}
