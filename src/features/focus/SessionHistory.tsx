import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { Card, EmptyState } from '@/components/ui/Card';
import { Badge, TrackerBadge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { MODE_LABELS } from '@/components/timer/TimerDial';
import { useTrackerMap, useTasks } from '@/state/useLiveData';
import { deleteSession, listSessions, summariseSessions } from '@/services/timerService';
import { toast } from '@/state/toastStore';
import { addDaysToKey, formatDuration, formatTime, relativeDayLabel, todayKey } from '@/lib/date';
import type { TimerMode, TimerSession } from '@/types';

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

const MODE_FILTERS: { value: TimerMode | 'all'; label: string }[] = [
  { value: 'all', label: 'All modes' },
  { value: 'focus', label: 'Focus' },
  { value: 'pomodoro', label: 'Pomodoro' },
  { value: 'stopwatch', label: 'Stopwatch' },
  { value: 'countdown', label: 'Countdown' },
  { value: 'paper', label: 'Paper' },
];

/** Past sessions with duration, task, tracker and date — all from stored rows. */
export function SessionHistory() {
  const [range, setRange] = useState('30');
  const [mode, setMode] = useState<TimerMode | 'all'>('all');
  const [trackerId, setTrackerId] = useState<string>('all');
  const [pendingDelete, setPendingDelete] = useState<TimerSession | null>(null);

  const trackerMap = useTrackerMap();
  const tasks = useTasks();
  const taskMap = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);

  const sessions = useLiveQuery(
    () => {
      const to = todayKey();
      const from = range === 'all' ? undefined : addDaysToKey(to, -(Number(range) - 1));
      return listSessions({ mode, trackerId, from, to: from ? to : undefined, limit: 300 });
    },
    [range, mode, trackerId],
  ) ?? [];

  const totals = useMemo(() => summariseSessions(sessions), [sessions]);

  const grouped = useMemo(() => {
    const map = new Map<string, TimerSession[]>();
    for (const s of sessions) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [sessions]);

  const trackers = Object.values(trackerMap).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={range} onChange={(e) => setRange(e.target.value)} className="w-auto">
          {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Select sizeVariant="sm" value={mode} onChange={(e) => setMode(e.target.value as TimerMode | 'all')} className="w-auto">
          {MODE_FILTERS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
        <Select sizeVariant="sm" value={trackerId} onChange={(e) => setTrackerId(e.target.value)} className="w-auto">
          <option value="all">All trackers</option>
          {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </div>

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Summary label="Sessions" value={String(totals.count)} />
          <Summary label="Tracked" value={formatDuration(totals.workMs / 60_000)} />
          <Summary label="Breaks" value={formatDuration(totals.breakMs / 60_000)} />
          <Summary label="Pomodoros" value={String(totals.pomodoros)} />
        </div>
      </Card>

      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Start a timer above — every finished session is recorded here with its duration, task and tracker."
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(([date, rows]) => (
            <section key={date}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="t-section">{relativeDayLabel(date)}</h3>
                <span className="t-meta">
                  {formatDuration(rows.reduce((s, r) => s + r.workMs, 0) / 60_000)} · {rows.length} session{rows.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="space-y-1.5">
                {rows.map((s) => {
                  const tracker = trackerMap[s.trackerId];
                  const task = s.taskId ? taskMap[s.taskId] : null;
                  return (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-surface-raised px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                        <div className="truncate text-sm font-medium text-ink">
                          {task ? task.title : `${MODE_LABELS[s.mode]} session`}
                        </div>
                        <div className="t-meta">
                          {formatTime(s.startedAt)}
                          {s.endedAt ? ` – ${formatTime(s.endedAt)}` : ''}
                          {s.interruptions > 0 ? ` · ${s.interruptions} pause${s.interruptions === 1 ? '' : 's'}` : ''}
                          {s.pomodoroCount > 0 ? ` · ${s.pomodoroCount} pomodoro${s.pomodoroCount === 1 ? '' : 's'}` : ''}
                        </div>
                      </div>
                      {tracker ? <TrackerBadge color={tracker.color} name={tracker.name} /> : null}
                      <Badge tone="neutral">{MODE_LABELS[s.mode]}</Badge>
                      {!s.completed ? <Badge tone="caution">Stopped early</Badge> : null}
                      <div className="t-num w-16 text-right text-sm font-medium text-ink">
                        {formatDuration(s.workMs / 60_000)}
                      </div>
                      <IconButton label="Delete session" size="xs" onClick={() => setPendingDelete(s)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        danger
        title="Delete session?"
        confirmLabel="Delete"
        message="The recorded time is removed from the linked task and from analytics. This cannot be undone."
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          void deleteSession(target.id).then(() => toast.success('Session deleted'));
        }}
      />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="t-label">{label}</div>
      <div className="t-num mt-1 text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}
