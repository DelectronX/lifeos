import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import { scheduleTaskAt, findConflicts, getBlocksForDay } from '@/services/scheduleService';
import { loadTrackerAncestors } from '@/services/planService';
import { canHost, isSameArea } from '@/engines/scheduling';
import { atMinute, formatDuration, formatTimeRange, todayKey } from '@/lib/date';
import type { ScheduleBlock, Task } from '@/types';

/**
 * Places a task on the calendar. Shows any real conflicts on the chosen day
 * before committing, so the user is never surprised by a double-booking.
 */
export function ScheduleTaskModal({
  open, task, onClose, defaultDate,
}: {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  defaultDate?: string;
}) {
  const [date, setDate] = useState(defaultDate ?? todayKey());
  const [time, setTime] = useState('09:00');
  const [minutes, setMinutes] = useState('60');
  const [conflicts, setConflicts] = useState<ScheduleBlock[]>([]);
  /** Same-area container blocks the task sits inside — not a conflict. */
  const [hosts, setHosts] = useState<ScheduleBlock[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !task) return;
    setDate(task.dueDate ?? defaultDate ?? todayKey());
    setMinutes(String(Math.max(5, task.estimatedMinutes - task.actualMinutes || task.estimatedMinutes)));
    setTime(defaultStartTime(task));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [h, m] = time.split(':').map(Number);
      const start = atMinute(date, (h || 0) * 60 + (m || 0));
      const end = start + Math.max(5, Number(minutes) || 60) * 60_000;
      const [dayBlocks, ancestors] = await Promise.all([getBlocksForDay(date), loadTrackerAncestors()]);
      const all = findConflicts(dayBlocks, start, end).filter((b) => b.taskId !== task?.id);
      const same = all.filter((b) => task && canHost(b) && isSameArea(task.trackerId, b.trackerId, ancestors));
      if (!cancelled) {
        setHosts(same);
        setConflicts(all.filter((b) => !same.includes(b)));
      }
    })();
    return () => { cancelled = true; };
  }, [open, date, time, minutes, task]);

  if (!task) return null;

  const submit = async (overlapConfirmed = false) => {
    // Different-area overlap is allowed, but only after the user says so.
    if (conflicts.length > 0 && !overlapConfirmed) { setConfirming(true); return; }
    setConfirming(false);
    const [h, m] = time.split(':').map(Number);
    const start = atMinute(date, (h || 0) * 60 + (m || 0));
    setSaving(true);
    try {
      const hostId = hosts[0]?.id ?? (overlapConfirmed ? conflicts[0]?.id : undefined) ?? null;
      const block = await scheduleTaskAt(task.id, start, Math.max(5, Number(minutes) || 60), hostId);
      if (block) toast.success('Scheduled', `${task.title} · ${formatTimeRange(block.start, block.end)}`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Schedule task"
      description={task.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving}>Add to schedule</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start">
            <Input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <Input type="number" min={5} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>

        <div className="t-meta">
          Estimated {formatDuration(task.estimatedMinutes)}
          {task.actualMinutes > 0 ? `, ${formatDuration(task.actualMinutes)} already done` : ''}.
        </div>

        {hosts.length > 0 ? (
          <div className="rounded-[var(--r-lg)] bg-surface-sunken px-3 py-2">
            <div className="text-xs font-medium text-ink">
              Inside {hosts.map((b) => `“${b.title}”`).join(', ')} — same area, so it shares that slot.
            </div>
          </div>
        ) : null}

        {conflicts.length > 0 ? (
          <div className="rounded-lg border border-caution/30 bg-caution/5 px-3 py-2">
            <div className="text-xs font-medium text-caution">
              Overlaps {conflicts.length} block{conflicts.length === 1 ? '' : 's'} from a different area
            </div>
            <ul className="mt-1 space-y-0.5">
              {conflicts.slice(0, 4).map((c) => (
                <li key={c.id} className="t-meta">{c.title} · {formatTimeRange(c.start, c.end)}</li>
              ))}
            </ul>
            <div className="t-meta mt-1">You will be asked to confirm before it is scheduled on top.</div>
          </div>
        ) : null}
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title="Overlap this slot?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Pick another time</Button>
            <Button variant="primary" onClick={() => void submit(true)}>Yes, overlap</Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          “{task.title}” would overlap {conflicts.map((c) => `“${c.title}”`).join(', ')}, which
          belong{conflicts.length === 1 ? 's' : ''} to a different area. Schedule it there anyway?
        </p>
      </Modal>
    </Modal>
  );
}

/** Seeds a sensible start hour from the task's preferred window. */
function defaultStartTime(task: Task): string {
  switch (task.preferredWindow) {
    case 'morning': return '09:00';
    case 'afternoon': return '14:00';
    case 'evening': return '18:00';
    case 'night': return '21:00';
    default: {
      const now = new Date();
      const next = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
      const h = Math.min(22, Math.floor(next / 60));
      return `${String(h).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
    }
  }
}
