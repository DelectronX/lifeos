import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Trash2, X } from 'lucide-react';
import {
  useBlocksForTask, useGoals, useMilestones, useOpenTasks, useResources, useTrackers,
} from '@/state/useLiveData';
import { createTask, updateTask } from '@/services/taskService';
import { deleteBlock, scheduleTaskAt } from '@/services/scheduleService';
import { toast } from '@/state/toastStore';
import { atMinute, formatDuration, formatTimeRange, MINUTE_MS, todayKey } from '@/lib/date';
import { STATUS_LABELS } from '@/services/taskQuery';
import type { DateKey, ID, Intensity, Task, TaskFlexibility, TaskType, TimeWindow } from '@/types';

const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: 'study', label: 'Study' },
  { value: 'practice', label: 'Practice' },
  { value: 'revision', label: 'Revision' },
  { value: 'reading', label: 'Reading' },
  { value: 'writing', label: 'Writing' },
  { value: 'workout', label: 'Workout' },
  { value: 'project', label: 'Project' },
  { value: 'admin', label: 'Admin' },
  { value: 'chore', label: 'Chore' },
  { value: 'other', label: 'Other' },
];

const WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
];

const FLEXIBILITY: { value: TaskFlexibility; label: string; hint: string }[] = [
  { value: 'flexible', label: 'Flexible', hint: 'May be moved, split and reshaped.' },
  { value: 'movable', label: 'Movable', hint: 'May be moved but not split.' },
  { value: 'fixed', label: 'Fixed', hint: 'Stays exactly where you put it.' },
];

export interface TaskFormDefaults {
  trackerId?: ID;
  goalId?: ID;
  milestoneId?: ID;
  dueDate?: DateKey;
  type?: TaskType;
}

interface FormState {
  title: string;
  notes: string;
  trackerId: string;
  topic: string;
  goalId: string;
  milestoneId: string;
  type: TaskType;
  basePriority: 1 | 2 | 3 | 4 | 5;
  dueDate: string;
  earliestDate: string;
  deadlineHard: boolean;
  estimatedMinutes: string;
  actualMinutes: string;
  preferredWindow: TimeWindow;
  intensity: Intensity;
  flexibility: TaskFlexibility;
  splittable: boolean;
  minSessionMinutes: string;
  maxSessionMinutes: string;
  tags: string;
  dependsOn: string[];
  resourceIds: string[];
  links: string[];
  /** Optional: when set the task is also placed on the calendar on save. */
  scheduleTime: string;
}

function initialForm(task: Task | null, defaultTrackerId: string, defaults?: TaskFormDefaults): FormState {
  return {
    title: task?.title ?? '',
    notes: task?.notes ?? '',
    trackerId: task?.trackerId ?? defaults?.trackerId ?? defaultTrackerId,
    topic: task?.topic ?? '',
    goalId: task?.goalId ?? defaults?.goalId ?? '',
    milestoneId: task?.milestoneId ?? defaults?.milestoneId ?? '',
    type: task?.type ?? defaults?.type ?? 'other',
    basePriority: task?.basePriority ?? 3,
    dueDate: task?.dueDate ?? defaults?.dueDate ?? '',
    earliestDate: task?.earliestDate ?? '',
    deadlineHard: task?.deadlineHard ?? false,
    estimatedMinutes: String(task?.estimatedMinutes ?? 45),
    actualMinutes: String(task?.actualMinutes ?? 0),
    preferredWindow: task?.preferredWindow ?? 'any',
    intensity: task?.intensity ?? 'medium',
    flexibility: task?.flexibility ?? 'flexible',
    splittable: task?.splittable ?? true,
    minSessionMinutes: String(task?.minSessionMinutes ?? 20),
    maxSessionMinutes: String(task?.maxSessionMinutes ?? 120),
    tags: (task?.tags ?? []).join(', '),
    dependsOn: task?.dependsOn ?? [],
    resourceIds: task?.resourceIds ?? [],
    links: task?.links ?? [],
    scheduleTime: '',
  };
}

type TabKey = 'basics' | 'planning' | 'links' | 'history';

export function TaskDialog({
  open, task, onClose, defaults, onCreated,
}: {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  defaults?: TaskFormDefaults;
  onCreated?: (id: ID) => void;
}) {
  const trackers = useTrackers();
  const goals = useGoals(false);
  const openTasks = useOpenTasks();
  const resources = useResources();
  const [tab, setTab] = useState<TabKey>('basics');
  const [form, setForm] = useState<FormState>(() => initialForm(null, '', defaults));
  const [saving, setSaving] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');

  const fallbackTracker = trackers.find((t) => t.pillar !== 'system')?.id ?? trackers[0]?.id ?? '';

  useEffect(() => {
    if (!open) return;
    setTab('basics');
    setLinkDraft('');
    setForm(initialForm(task, fallbackTracker, defaults));
    // Re-seeding only when the dialog opens or targets a different task is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const milestones = useMilestones(form.goalId || undefined);
  const taskBlocks = useBlocksForTask(task?.id);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const scheduledMinutes = useMemo(
    () => taskBlocks
      .filter((b) => b.status === 'planned' || b.status === 'in_progress')
      .reduce((s, b) => s + (b.end - b.start) / MINUTE_MS, 0),
    [taskBlocks],
  );
  const estimate = clampInt(form.estimatedMinutes, 1, 24 * 60, 45);
  const actual = clampInt(form.actualMinutes, 0, 24 * 60 * 7, 0);
  const remaining = Math.max(0, estimate - actual - scheduledMinutes);

  const save = async () => {
    const title = form.title.trim();
    if (!title) { toast.error('Title is required'); setTab('basics'); return; }
    if (!form.trackerId) { toast.error('Pick a tracker'); setTab('basics'); return; }

    setSaving(true);
    try {
      const payload = {
        title,
        notes: form.notes.trim() || undefined,
        trackerId: form.trackerId,
        topic: form.topic.trim() || undefined,
        goalId: form.goalId || null,
        milestoneId: form.milestoneId || null,
        type: form.type,
        basePriority: form.basePriority,
        dueDate: form.dueDate || null,
        earliestDate: form.earliestDate || null,
        deadlineHard: form.deadlineHard,
        estimatedMinutes: estimate,
        preferredWindow: form.preferredWindow,
        intensity: form.intensity,
        flexibility: form.flexibility,
        splittable: form.flexibility === 'flexible' && form.splittable,
        minSessionMinutes: clampInt(form.minSessionMinutes, 5, 480, 20),
        maxSessionMinutes: clampInt(form.maxSessionMinutes, 10, 600, 120),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        dependsOn: form.dependsOn,
        resourceIds: form.resourceIds,
        links: form.links,
      };

      let savedId: ID;
      if (task) {
        await updateTask(task.id, { ...payload, actualMinutes: actual });
        savedId = task.id;
        toast.success('Task updated');
      } else {
        const created = await createTask(payload);
        savedId = created.id;
        onCreated?.(created.id);
        toast.success('Task created');
      }

      // Optional inline scheduling: places the task on the calendar immediately.
      if (form.scheduleTime && form.dueDate) {
        const [h, m] = form.scheduleTime.split(':').map(Number);
        const start = atMinute(form.dueDate, (h || 0) * 60 + (m || 0));
        const block = await scheduleTaskAt(savedId, start, estimate);
        if (block) toast.success('Scheduled', `Placed at ${form.scheduleTime} on ${form.dueDate}`);
      }
      onClose();
    } catch (e) {
      toast.error('Could not save task', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const addLink = () => {
    const v = linkDraft.trim();
    if (!v) return;
    set('links', [...form.links, v]);
    setLinkDraft('');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={task ? 'Edit task' : 'New task'}
      description={task ? `${STATUS_LABELS[task.status]} · created ${new Date(task.createdAt).toLocaleDateString()}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <Tabs
        variant="pill"
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'basics' as const, label: 'Basics' },
          { value: 'planning' as const, label: 'Planning' },
          { value: 'links' as const, label: 'Links' },
          ...(task ? [{ value: 'history' as const, label: 'History' }] : []),
        ]}
      />

      {tab === 'basics' && (
        <div className="space-y-4">
          <Field label="Title" required>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Rotational motion problem set"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save(); }}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tracker" required>
              <Select value={form.trackerId} onChange={(e) => set('trackerId', e.target.value)}>
                {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Topic" hint="Chapter, module or focus area.">
              <Input value={form.topic} onChange={(e) => set('topic', e.target.value)} placeholder="e.g. Rigid body dynamics" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" hint="Groups history for duration prediction.">
              <Select value={form.type} onChange={(e) => set('type', e.target.value as TaskType)}>
                {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Priority">
              <Select
                value={String(form.basePriority)}
                onChange={(e) => set('basePriority', Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
              >
                <option value="5">5 — Critical</option>
                <option value="4">4 — High</option>
                <option value="3">3 — Normal</option>
                <option value="2">2 — Low</option>
                <option value="1">1 — Someday</option>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Due / deadline">
              <Input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
            </Field>
            <Field label="Earliest date" hint="Not before this day.">
              <Input type="date" value={form.earliestDate} onChange={(e) => set('earliestDate', e.target.value)} />
            </Field>
            <Field label="Start time" hint={form.dueDate ? 'Also places a block.' : 'Set a due date first.'}>
              <Input
                type="time"
                step={300}
                disabled={!form.dueDate}
                value={form.scheduleTime}
                onChange={(e) => set('scheduleTime', e.target.value)}
              />
            </Field>
          </div>

          <Toggle
            checked={form.deadlineHard}
            onChange={(v) => set('deadlineHard', v)}
            label="Hard deadline"
            description="The scheduler will never place this task after its due date."
          />

          <Field label="Notes">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional detail, page numbers, approach…" />
          </Field>
        </div>
      )}

      {tab === 'planning' && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Estimated (min)">
              <Input type="number" min={5} step={5} value={form.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value)} />
            </Field>
            <Field label="Actual (min)" hint="Rolled up from timers and completions.">
              <Input type="number" min={0} step={5} value={form.actualMinutes} onChange={(e) => set('actualMinutes', e.target.value)} disabled={!task} />
            </Field>
            <Field label="Remaining" hint="Estimate − done − already blocked out.">
              <div className="flex h-9 items-center rounded-lg border border-line bg-surface-sunken px-3 text-sm text-ink t-num">
                {formatDuration(remaining)}
              </div>
            </Field>
          </div>

          {scheduledMinutes > 0 ? (
            <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
              <div className="t-meta">
                {formatDuration(scheduledMinutes)} already on the calendar across {taskBlocks.length} block
                {taskBlocks.length === 1 ? '' : 's'}.
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preferred window" hint="A soft preference — the scheduler scores it.">
              <Select value={form.preferredWindow} onChange={(e) => set('preferredWindow', e.target.value as TimeWindow)}>
                {WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </Select>
            </Field>
            <Field label="Energy / intensity" hint="High-intensity sessions get an enforced break after them.">
              <Select value={form.intensity} onChange={(e) => set('intensity', e.target.value as Intensity)}>
                <option value="low">Low energy</option>
                <option value="medium">Medium energy</option>
                <option value="high">High energy</option>
              </Select>
            </Field>
          </div>

          <Field
            label="Flexibility"
            hint={FLEXIBILITY.find((f) => f.value === form.flexibility)?.hint}
          >
            <Select value={form.flexibility} onChange={(e) => set('flexibility', e.target.value as TaskFlexibility)}>
              {FLEXIBILITY.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </Field>

          <Toggle
            checked={form.splittable && form.flexibility === 'flexible'}
            disabled={form.flexibility !== 'flexible'}
            onChange={(v) => set('splittable', v)}
            label="Can be split across sessions"
            description="Allows the scheduler to break the estimate into several blocks."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Min session (min)" hint="Shorter free slots are skipped.">
              <Input type="number" min={5} step={5} value={form.minSessionMinutes} onChange={(e) => set('minSessionMinutes', e.target.value)} disabled={!form.splittable} />
            </Field>
            <Field label="Max session (min)" hint="Longer placements are split.">
              <Input type="number" min={10} step={5} value={form.maxSessionMinutes} onChange={(e) => set('maxSessionMinutes', e.target.value)} disabled={!form.splittable} />
            </Field>
          </div>

          <Field label="Tags" hint="Comma separated.">
            <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="mechanics, jee, urgent" />
          </Field>
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Goal">
              <Select value={form.goalId} onChange={(e) => { set('goalId', e.target.value); set('milestoneId', ''); }}>
                <option value="">None</option>
                {goals.filter((g) => g.status === 'active' || g.id === form.goalId).map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </Select>
            </Field>
            <Field label="Milestone">
              <Select value={form.milestoneId} onChange={(e) => set('milestoneId', e.target.value)} disabled={!form.goalId}>
                <option value="">None</option>
                {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Resources" hint="Books, courses or notes this task works through.">
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {resources.length === 0 && <div className="t-meta px-1 py-2">No resources yet.</div>}
              {resources.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-surface-sunken">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-line-strong accent-[rgb(var(--c-accent))]"
                    checked={form.resourceIds.includes(r.id)}
                    onChange={(e) =>
                      set('resourceIds', e.target.checked
                        ? [...form.resourceIds, r.id]
                        : form.resourceIds.filter((x) => x !== r.id))
                    }
                  />
                  <span className="truncate text-xs text-ink">{r.title}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="Attachments / links" hint="URLs or file paths kept with the task.">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
                  placeholder="https://…"
                  className="flex-1"
                />
                <Button onClick={addLink} disabled={!linkDraft.trim()}>Add</Button>
              </div>
              {form.links.length > 0 && (
                <ul className="space-y-1">
                  {form.links.map((l, i) => (
                    <li key={`${l}-${i}`} className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-2 py-1">
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{l}</span>
                      <IconButton
                        label="Remove link"
                        size="xs"
                        onClick={() => set('links', form.links.filter((_, j) => j !== i))}
                      >
                        <X className="h-3 w-3" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>

          <Field label="Depends on" hint="Not auto-scheduled until every dependency is complete.">
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {openTasks.filter((t) => t.id !== task?.id).length === 0 && (
                <div className="t-meta px-1 py-2">No other open tasks.</div>
              )}
              {openTasks
                .filter((t) => t.id !== task?.id)
                .slice(0, 200)
                .map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-surface-sunken">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-line-strong accent-[rgb(var(--c-accent))]"
                      checked={form.dependsOn.includes(t.id)}
                      onChange={(e) =>
                        set('dependsOn', e.target.checked
                          ? [...form.dependsOn, t.id]
                          : form.dependsOn.filter((x) => x !== t.id))
                      }
                    />
                    <span className="truncate text-xs text-ink">{t.title}</span>
                  </label>
                ))}
            </div>
          </Field>
        </div>
      )}

      {tab === 'history' && task && (
        <div className="space-y-5">
          <div>
            <div className="t-label mb-2">Status history</div>
            <ol className="space-y-2">
              {[...task.statusHistory].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex items-start gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
                  <Badge tone="neutral">{STATUS_LABELS[h.to]}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="t-meta">
                      {h.from ? `${STATUS_LABELS[h.from]} → ${STATUS_LABELS[h.to]}` : 'Created'}
                    </div>
                    {h.reason ? <div className="mt-0.5 text-xs text-ink-muted">{h.reason}</div> : null}
                  </div>
                  <div className="t-meta shrink-0">{new Date(h.at).toLocaleString()}</div>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <div className="t-label mb-2">Scheduled blocks</div>
            {taskBlocks.length === 0 ? (
              <div className="t-meta">Not on the calendar yet.</div>
            ) : (
              <ul className="space-y-1">
                {taskBlocks.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">{b.date}</div>
                      <div className="t-meta">{formatTimeRange(b.start, b.end)} · {b.status}</div>
                    </div>
                    <IconButton
                      label="Remove block"
                      size="xs"
                      onClick={async () => { await deleteBlock(b.id); toast.success('Block removed'); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {task.rescheduleCount > 0 ? (
            <div className="t-meta">Rescheduled {task.rescheduleCount} time{task.rescheduleCount === 1 ? '' : 's'}.</div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/** Quick-add: title + tracker only, everything else defaulted. */
export function QuickAddTask({
  onAdded, defaultDueDate, className,
}: {
  onAdded?: (id: ID) => void;
  defaultDueDate?: DateKey | null;
  className?: string;
}) {
  const trackers = useTrackers();
  const [title, setTitle] = useState('');
  const [trackerId, setTrackerId] = useState('');
  const [busy, setBusy] = useState(false);
  const effectiveTracker = trackerId || trackers.find((t) => t.pillar !== 'system')?.id || trackers[0]?.id || '';

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || !effectiveTracker) return;
    setBusy(true);
    try {
      const created = await createTask({
        title: trimmed,
        trackerId: effectiveTracker,
        dueDate: defaultDueDate === null ? null : (defaultDueDate ?? todayKey()),
      });
      setTitle('');
      onAdded?.(created.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        placeholder="Quick add a task…"
        className="flex-1"
      />
      <Select value={effectiveTracker} onChange={(e) => setTrackerId(e.target.value)} className="hidden w-36 sm:block">
        {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
      <Button variant="primary" onClick={submit} disabled={!title.trim()} loading={busy}>Add</Button>
    </div>
  );
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
