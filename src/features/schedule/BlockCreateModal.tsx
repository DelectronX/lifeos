import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import { createBlock, findConflicts, getBlocksForDay } from '@/services/scheduleService';
import { createRecurringRule, materialiseRule } from '@/services/recurrenceService';
import { useOpenTasks, useTrackers } from '@/state/useLiveData';
import { addDaysToKey, atMinute, formatTimeRange, MINUTE_MS, todayKey } from '@/lib/date';
import { KIND_LABELS } from './blockStyles';
import type { BlockKind, DateKey, RecurrenceFreq, ScheduleBlock } from '@/types';

const KINDS: BlockKind[] = ['task', 'fixed', 'break', 'buffer', 'sleep', 'meal', 'event'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Create a block — either a one-off, or the definition of a recurring series
 * which is immediately materialised across a 90-day horizon.
 */
export function BlockCreateModal({
  open, onClose, date, startMinute, defaultMinutes = 60, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  date: DateKey;
  startMinute: number;
  defaultMinutes?: number;
  onCreated?: (block: ScheduleBlock) => void;
}) {
  const trackers = useTrackers();
  const openTasks = useOpenTasks();

  const [title, setTitle] = useState('');
  const [trackerId, setTrackerId] = useState('');
  const [kind, setKind] = useState<BlockKind>('event');
  const [taskId, setTaskId] = useState('');
  const [time, setTime] = useState('09:00');
  const [minutes, setMinutes] = useState(String(defaultMinutes));
  const [day, setDay] = useState(date);
  const [notes, setNotes] = useState('');
  const [isProtected, setIsProtected] = useState(false);
  const [locked, setLocked] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly');
  const [interval, setInterval] = useState('1');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [until, setUntil] = useState('');
  const [conflicts, setConflicts] = useState<ScheduleBlock[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setTaskId('');
    setNotes('');
    setKind('event');
    setRepeat(false);
    setMinutes(String(defaultMinutes));
    setDay(date);
    setTime(`${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')}`);
    setTrackerId(trackers.find((t) => t.pillar !== 'system')?.id ?? trackers[0]?.id ?? '');
    setWeekdays([new Date(atMinute(date, 0)).getDay()]);
    setUntil('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date, startMinute, defaultMinutes]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [h, m] = time.split(':').map(Number);
      const start = atMinute(day, (h || 0) * 60 + (m || 0));
      const end = start + Math.max(5, Number(minutes) || 60) * MINUTE_MS;
      const existing = await getBlocksForDay(day);
      if (!cancelled) setConflicts(findConflicts(existing, start, end));
    })();
    return () => { cancelled = true; };
  }, [open, day, time, minutes]);

  const submit = async () => {
    const trimmed = title.trim() || openTasks.find((t) => t.id === taskId)?.title || '';
    if (!trimmed) { toast.error('Give the block a title'); return; }
    if (!trackerId) { toast.error('Pick a tracker'); return; }

    const [h, m] = time.split(':').map(Number);
    const startMin = (h || 0) * 60 + (m || 0);
    const durationMinutes = Math.max(5, Number(minutes) || 60);

    setSaving(true);
    try {
      if (repeat) {
        const rule = await createRecurringRule({
          title: trimmed,
          freq,
          interval: Math.max(1, Number(interval) || 1),
          byWeekday: freq === 'weekly' ? (weekdays.length ? weekdays : [new Date(atMinute(day, 0)).getDay()]) : [],
          byMonthDay: freq === 'monthly' ? [new Date(atMinute(day, 0)).getDate()] : [],
          startDate: day,
          endDate: until || null,
          target: 'block',
          blockTemplate: {
            startMinute: startMin,
            durationMinutes,
            trackerId,
            title: trimmed,
            kind,
            protected: isProtected,
          },
        });
        const horizonEnd = until && until < addDaysToKey(day, 120) ? until : addDaysToKey(day, 120);
        const res = await materialiseRule(rule, day, horizonEnd);
        toast.success('Recurring block created', `${res.blocksCreated} occurrence${res.blocksCreated === 1 ? '' : 's'} added.`);
      } else {
        const start = atMinute(day, startMin);
        const block = await createBlock({
          title: trimmed,
          start,
          end: start + durationMinutes * MINUTE_MS,
          trackerId,
          kind: taskId ? 'task' : kind,
          taskId: taskId || null,
          protected: isProtected,
          locked,
          notes: notes.trim() || undefined,
          origin: 'manual',
        });
        onCreated?.(block);
        toast.success('Block added', formatTimeRange(block.start, block.end));
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="New schedule block"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={saving}>Add block</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" required>
          <Input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Physics — rotational motion"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(); }}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Start">
            <Input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <Input type="number" min={5} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tracker" required>
            <Select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>
              {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as BlockKind)} disabled={!!taskId}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Attach a task" hint="Optional — links completion back to the task.">
          <Select
            value={taskId}
            onChange={(e) => {
              setTaskId(e.target.value);
              const t = openTasks.find((x) => x.id === e.target.value);
              if (t) {
                if (!title.trim()) setTitle(t.title);
                setTrackerId(t.trackerId);
                setMinutes(String(Math.max(5, t.estimatedMinutes - t.actualMinutes || t.estimatedMinutes)));
              }
            }}
          >
            <option value="">None</option>
            {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
        </Field>

        {conflicts.length > 0 ? (
          <div className="rounded-lg border border-caution/30 bg-caution/5 px-3 py-2">
            <div className="text-xs font-medium text-caution">
              Overlaps {conflicts.length} block{conflicts.length === 1 ? '' : 's'} on this day
            </div>
            <ul className="mt-1 space-y-0.5">
              {conflicts.slice(0, 3).map((c) => (
                <li key={c.id} className="t-meta">{c.title} · {formatTimeRange(c.start, c.end)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-3 rounded-lg border border-line px-3 py-3">
          <Toggle checked={isProtected} onChange={setIsProtected} label="Protected time" description="Engines never schedule over it." />
          <Toggle checked={locked} onChange={setLocked} label="Locked" description="Cannot be dragged or auto-moved." />
          <Toggle checked={repeat} onChange={setRepeat} label="Repeat" description="Creates a recurring series with editable occurrences." />
        </div>

        {repeat ? (
          <div className="space-y-3 rounded-lg border border-accent/20 bg-accent-soft/40 px-3 py-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Frequency">
                <Select value={freq} onChange={(e) => setFreq(e.target.value as RecurrenceFreq)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </Field>
              <Field label="Every">
                <Input type="number" min={1} value={interval} onChange={(e) => setInterval(e.target.value)} />
              </Field>
              <Field label="Until" hint="Optional.">
                <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} min={day} />
              </Field>
            </div>
            {freq === 'weekly' ? (
              <div>
                <div className="t-label mb-1.5">On days</div>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))}
                      className={
                        weekdays.includes(i)
                          ? 'rounded-md border border-accent/30 bg-accent text-white px-2 py-1 text-2xs font-medium dark:text-slate-950'
                          : 'rounded-md border border-line bg-surface px-2 py-1 text-2xs text-ink-muted hover:border-line-strong'
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!repeat ? (
          <Field label="Notes">
            <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

/** Convenience default when the user has not clicked a specific slot. */
export function defaultCreateSlot(): { date: DateKey; startMinute: number } {
  const now = new Date();
  const minute = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  return { date: todayKey(), startMinute: Math.min(23 * 60, minute) };
}
