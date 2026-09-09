import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import { createGoal, updateGoal } from '@/services/goalService';
import { GOAL_TYPE_HELP, GOAL_TYPE_LABELS, requiresTargetValue } from '@/services/goalQuery';
import { useTrackers } from '@/state/useLiveData';
import { todayKey } from '@/lib/date';
import { TRACKER_COLORS } from '@/config/trackers';
import { cn } from '@/lib/cn';
import type { Goal, GoalStatus, GoalType, ID, TrackerColor } from '@/types';

const TYPES: GoalType[] = ['completion', 'milestone', 'metric', 'time', 'habit'];
const STATUSES: GoalStatus[] = ['active', 'paused', 'completed', 'abandoned'];

export function GoalDialog({
  open, goal, onClose, onCreated,
}: {
  open: boolean;
  goal: Goal | null;
  onClose: () => void;
  onCreated?: (id: ID) => void;
}) {
  const trackers = useTrackers();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<GoalType>('milestone');
  const [trackerId, setTrackerId] = useState('');
  const [status, setStatus] = useState<GoalStatus>('active');
  const [startDate, setStartDate] = useState(todayKey());
  const [targetDate, setTargetDate] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [unit, setUnit] = useState('');
  const [weight, setWeight] = useState('0.5');
  const [color, setColor] = useState<TrackerColor | ''>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(goal?.title ?? '');
    setDescription(goal?.description ?? '');
    setType(goal?.type ?? 'milestone');
    setTrackerId(goal?.trackerId ?? trackers.find((t) => t.pillar !== 'system')?.id ?? trackers[0]?.id ?? '');
    setStatus(goal?.status ?? 'active');
    setStartDate(goal?.startDate ?? todayKey());
    setTargetDate(goal?.targetDate ?? '');
    setTargetValue(goal?.targetValue != null ? String(goal.targetValue) : '');
    setUnit(goal?.unit ?? '');
    setWeight(String(goal?.weight ?? 0.5));
    setColor(goal?.color ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id]);

  const needsTarget = requiresTargetValue(type);

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed) { toast.error('Give the goal a title'); return; }
    if (!trackerId) { toast.error('Pick a tracker'); return; }
    if (needsTarget && !(Number(targetValue) > 0)) {
      toast.error('This goal type needs a target value greater than zero');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: trimmed,
        description: description.trim() || undefined,
        type,
        trackerId,
        startDate,
        targetDate: targetDate || null,
        targetValue: needsTarget ? Number(targetValue) : null,
        unit: unit.trim() || (type === 'time' ? 'minutes' : undefined),
        weight: clamp01(Number(weight)),
        color: color || undefined,
      };
      if (goal) {
        await updateGoal(goal.id, { ...payload, status });
        toast.success('Goal updated');
      } else {
        const created = await createGoal(payload);
        onCreated?.(created.id);
        toast.success('Goal created', 'Add milestones or link tasks to start tracking progress.');
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
      title={goal ? 'Edit goal' : 'New goal'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>{goal ? 'Save changes' : 'Create goal'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" required>
          <Input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Finish JEE mechanics syllabus"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tracker" required>
            <Select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>
              {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Type" hint={GOAL_TYPE_HELP[type]}>
            <Select value={type} onChange={(e) => setType(e.target.value as GoalType)}>
              {TYPES.map((t) => <option key={t} value={t}>{GOAL_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
        </div>

        {needsTarget ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={type === 'time' ? 'Target minutes' : 'Target value'} required>
              <Input
                type="number"
                min={1}
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder={type === 'time' ? '1200' : '500'}
              />
            </Field>
            <Field label="Unit" hint={type === 'time' ? 'Fixed to minutes.' : 'e.g. pages, reps, marks.'}>
              <Input
                value={type === 'time' ? 'minutes' : unit}
                disabled={type === 'time'}
                onChange={(e) => setUnit(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Target date" hint="Used to compute whether you are ahead or behind pace.">
            <Input type="date" value={targetDate} min={startDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Weight" hint="How much this goal boosts its tasks' priority (0 – 1).">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="flex-1 accent-[rgb(var(--c-accent))]"
            />
            <span className="t-num w-10 text-right text-sm text-ink">{Number(weight).toFixed(2)}</span>
          </div>
        </Field>

        {goal ? (
          <Field label="Status" hint="Completed is set automatically when progress reaches 100%.">
            <Select value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </Select>
          </Field>
        ) : null}

        <Field label="Colour" hint="Defaults to the tracker's colour.">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setColor('')}
              className={cn(
                'rounded-md border px-2 py-1 text-2xs',
                color === '' ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink-muted',
              )}
            >
              Tracker
            </button>
            {TRACKER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn(
                  'h-7 w-7 rounded-md border-2',
                  color === c ? 'border-accent' : 'border-transparent',
                )}
              >
                <span className={cn('block h-full w-full rounded', swatch(c))} />
              </button>
            ))}
          </div>
        </Field>

        <Field label="Description">
          <Textarea value={description} rows={2} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function swatch(c: TrackerColor): string {
  const map: Record<TrackerColor, string> = {
    indigo: 'bg-indigo-500', teal: 'bg-teal-500', amber: 'bg-amber-500', rose: 'bg-rose-500',
    violet: 'bg-violet-500', slate: 'bg-slate-400', sky: 'bg-sky-500', lime: 'bg-lime-500', stone: 'bg-stone-400',
  };
  return map[c];
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}
