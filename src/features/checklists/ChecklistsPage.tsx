import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyState } from '@/components/ui/EmptyState';
import { CheckCircle, InsetGroup, Meter, Row } from '@/components/ui/Grouped';
import { SegmentedProgress } from '@/components/charts/SegmentedProgress';
import { db } from '@/db/db';
import { formatDateKeyShort, todayKey, weekdayName } from '@/lib/date';
import { toast } from '@/state/toastStore';
import {
  checklistProgress, checklistStreak, dueDateFor, itemsFor, periodKeyFor,
} from '@/engines/workgrowth';
import { createChecklist, deleteChecklist, toggleChecklistItem, updateChecklist } from '@/services/checklistService';
import { newId } from '@/lib/id';
import type { Checklist, ChecklistCadence, ChecklistItem, ChecklistRun } from '@/types/workgrowth';

const CADENCES: Array<{ value: ChecklistCadence; label: string }> = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This week' },
  { value: 'monthly', label: 'This month' },
];

export function ChecklistsPage() {
  const [cadence, setCadence] = useState<ChecklistCadence>('daily');
  const [editing, setEditing] = useState<Checklist | 'new' | null>(null);
  const today = todayKey();
  const lists = useLiveQuery(() => db.checklists.orderBy('sortOrder').toArray(), []) ?? [];
  const runs = useLiveQuery(() => db.checklistRuns.toArray(), []) ?? [];

  const visible = lists.filter((l) => l.active && l.cadence === cadence);
  const counts = useMemo(() => {
    const out: Record<ChecklistCadence, { done: number; total: number }> = {
      daily: { done: 0, total: 0 }, weekly: { done: 0, total: 0 }, monthly: { done: 0, total: 0 },
    };
    for (const l of lists.filter((x) => x.active)) {
      const run = runs.find((r) => r.checklistId === l.id && r.periodKey === periodKeyFor(l.cadence, today));
      const p = checklistProgress(l, run, today);
      out[l.cadence].done += p.done;
      out[l.cadence].total += p.total;
    }
    return out;
  }, [lists, runs, today]);

  return (
    <Page
      title="Checklists"
      subtitle="Recurring routines. Each list resets on its own for every day, week or month."
      actions={<Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New list</Button>}
    >
      <div className="mb-6 max-w-md">
        <SegmentedControl
          aria-label="Period"
          fullWidth
          value={cadence}
          onChange={setCadence}
          items={CADENCES.map((c) => ({
            value: c.value,
            label: counts[c.value].total ? `${c.label}  ${counts[c.value].done}/${counts[c.value].total}` : c.label,
          }))}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-6 w-6" />}
          title={`No ${cadence} checklists`}
          description="Create one, or apply a configuration file that defines your routines."
          action={<Button variant="primary" onClick={() => setEditing('new')}>New {cadence} list</Button>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {visible.map((list) => (
            <ChecklistCard
              key={list.id}
              list={list}
              run={runs.find((r) => r.checklistId === list.id && r.periodKey === periodKeyFor(list.cadence, today))}
              runs={runs}
              today={today}
              onEdit={() => setEditing(list)}
            />
          ))}
        </div>
      )}

      {lists.some((l) => !l.active) ? (
        <InsetGroup header="Paused" className="mt-8 max-w-xl">
          {lists.filter((l) => !l.active).map((l) => (
            <Row
              key={l.id}
              title={l.title}
              subtitle={`${l.cadence} · ${l.items.length} items`}
              trailing={<Button size="sm" variant="ghost" onClick={() => void updateChecklist(l.id, { active: true })}>Resume</Button>}
            />
          ))}
        </InsetGroup>
      ) : null}

      {editing ? (
        <ChecklistEditor
          initial={editing === 'new' ? null : editing}
          defaultCadence={cadence}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Page>
  );
}

function ChecklistCard({
  list, run, runs, today, onEdit,
}: {
  list: Checklist;
  run: ChecklistRun | undefined;
  runs: ChecklistRun[];
  today: string;
  onEdit: () => void;
}) {
  const items = itemsFor(list, today);
  const p = checklistProgress(list, run, today);
  const streak = checklistStreak(list, runs, today);
  const due = list.cadence === 'daily' ? null : dueDateFor(list, today);
  const unit = list.cadence === 'daily' ? 'day' : list.cadence === 'weekly' ? 'week' : 'month';

  const tick = async (item: ChecklistItem) => {
    const r = await toggleChecklistItem(list.id, item.id, today);
    if (r.justCompleted) toast.success(`${list.title} complete`, list.completionXP ? `+${list.completionXP} XP` : undefined);
  };

  return (
    <InsetGroup
      header={list.title}
      action={<IconButton label={`Edit ${list.title}`} size="sm" variant="ghost" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></IconButton>}
      footer={[
        list.description,
        due ? `Due ${formatDateKeyShort(due)}` : null,
        streak > 0 ? `${streak} ${unit}${streak === 1 ? '' : 's'} in a row` : null,
        list.completionXP ? `${list.completionXP} XP when complete` : null,
      ].filter(Boolean).join(' · ')}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <MiniRing value={p.total ? p.done / p.total : 0} complete={p.complete} />
        <div className="min-w-0 flex-1">
          {items.length > 1 && items.length <= 24 ? (
            <SegmentedProgress
              color={p.complete ? 'rgb(var(--c-positive))' : 'rgb(var(--c-accent))'}
              segments={items.map((i) => ({ id: i.id, label: i.title, value: run?.checked[i.id] !== undefined ? 1 : 0 }))}
            />
          ) : (
            <Meter value={p.total ? p.done / p.total : 0} tone={p.complete ? 'positive' : 'accent'} />
          )}
        </div>
        {p.complete ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-positive/15 px-2 py-0.5 text-[0.75rem] font-semibold text-positive animate-in-pop">Done</span>
        ) : (
          <span className="text-[0.8125rem] tabular text-ink-muted">{p.done}/{p.total}</span>
        )}
      </div>
      {items.map((item) => {
        const checked = run?.checked[item.id] !== undefined;
        return (
          <Row
            key={item.id}
            leading={<CheckCircle checked={checked} label={item.title} onToggle={() => void tick(item)} />}
            title={<span className={checked ? 'text-ink-faint line-through decoration-ink-faint/60' : undefined}>{item.title}</span>}
            subtitle={[item.timing, item.doneDefinition].filter(Boolean).join(' · ') || undefined}
            trailing={item.area ? <span className="text-[0.75rem]">{item.area}</span> : undefined}
          />
        );
      })}
      {items.length === 0 ? <Row title={<span className="text-ink-muted">No items apply today.</span>} /> : null}
    </InsetGroup>
  );
}

function ChecklistEditor({
  initial, defaultCadence, onClose,
}: {
  initial: Checklist | null;
  defaultCadence: ChecklistCadence;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [cadence, setCadence] = useState<ChecklistCadence>(initial?.cadence ?? defaultCadence);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [xp, setXp] = useState(String(initial?.completionXP ?? ''));
  const [dueWeekday, setDueWeekday] = useState<string>(initial?.dueWeekday !== undefined ? String(initial.dueWeekday) : '');
  const [dueMonthDay, setDueMonthDay] = useState<string>(initial?.dueMonthDay !== undefined ? String(initial.dueMonthDay) : '');
  const [items, setItems] = useState<ChecklistItem[]>(initial?.items ?? []);
  const [draftItem, setDraftItem] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const addItem = () => {
    const t = draftItem.trim();
    if (!t) return;
    setItems((xs) => [...xs, { id: newId('cki'), title: t }]);
    setDraftItem('');
  };
  const patchItem = (id: string, patch: Partial<ChecklistItem>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const save = async () => {
    if (!title.trim()) { toast.error('Give the list a title.'); return; }
    const fields = {
      title: title.trim(), cadence, description: description.trim() || undefined, items,
      completionXP: Number(xp) > 0 ? Math.round(Number(xp)) : undefined,
      dueWeekday: cadence === 'weekly' && dueWeekday !== '' ? Number(dueWeekday) : undefined,
      dueMonthDay: cadence === 'monthly' && dueMonthDay !== '' ? (dueMonthDay === 'last' ? 'last' as const : Number(dueMonthDay)) : undefined,
    };
    if (initial) await updateChecklist(initial.id, fields);
    else await createChecklist(fields);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial ? 'Edit checklist' : 'New checklist'}
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          {initial ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => void updateChecklist(initial.id, { active: !initial.active }).then(onClose)}>
                {initial.active ? 'Pause' : 'Resume'}
              </Button>
              <Button variant="ghost" className="text-critical" onClick={() => setConfirmDelete(true)}>Delete</Button>
            </div>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()}>Done</Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Monthly review" autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Repeats">
            <Select value={cadence} onChange={(e) => setCadence(e.target.value as ChecklistCadence)}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </Select>
          </Field>
          {cadence === 'weekly' ? (
            <Field label="Due on">
              <Select value={dueWeekday} onChange={(e) => setDueWeekday(e.target.value)}>
                <option value="">End of week</option>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{weekdayName(d)}</option>)}
              </Select>
            </Field>
          ) : null}
          {cadence === 'monthly' ? (
            <Field label="Due on day">
              <Select value={dueMonthDay} onChange={(e) => setDueMonthDay(e.target.value)}>
                <option value="">Last day</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="XP when complete" hint="Optional. Paid once per period.">
            <Input inputMode="numeric" value={xp} onChange={(e) => setXp(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" />
          </Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>

        <InsetGroup header={`Items · ${items.length}`} className="-mx-1">
          {items.map((it) => (
            <div key={it.id} className="flex items-start gap-2 px-4 py-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Input value={it.title} onChange={(e) => patchItem(it.id, { title: e.target.value })} aria-label="Item title" />
                <div className="flex flex-wrap gap-1.5">
                  <Input className="h-8 max-w-[10rem] text-xs" value={it.timing ?? ''} placeholder="When (e.g. before 07:30)" onChange={(e) => patchItem(it.id, { timing: e.target.value || undefined })} />
                  <Input className="h-8 max-w-[8rem] text-xs" value={it.area ?? ''} placeholder="Area" onChange={(e) => patchItem(it.id, { area: e.target.value || undefined })} />
                  {cadence === 'daily' ? (
                    <div className="flex items-center gap-0.5" role="group" aria-label="Weekdays">
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                        const on = !it.days?.length || it.days.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={on}
                            onClick={() => {
                              const cur = it.days?.length ? it.days : [0, 1, 2, 3, 4, 5, 6];
                              const next = on ? cur.filter((x) => x !== d) : [...cur, d];
                              patchItem(it.id, { days: next.length === 7 ? undefined : next });
                            }}
                            className={`h-8 w-7 rounded-md text-[0.6875rem] font-medium ${on ? 'bg-accent-soft text-accent-ink' : 'text-ink-faint'}`}
                          >
                            {weekdayName(d, true).slice(0, 2)}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
              <IconButton label="Remove item" variant="ghost" size="sm" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
          ))}
          <form className="flex gap-2 px-4 py-2" onSubmit={(e) => { e.preventDefault(); addItem(); }}>
            <Input value={draftItem} onChange={(e) => setDraftItem(e.target.value)} placeholder="Add an item" />
            <Button type="submit" variant="secondary" disabled={!draftItem.trim()}>Add</Button>
          </form>
        </InsetGroup>
      </div>
      {initial ? (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete this checklist?"
          message="Its history of ticks is removed too. XP already earned stays."
          confirmLabel="Delete"
          danger
          onConfirm={() => void deleteChecklist(initial.id).then(onClose)}
        />
      ) : null}
    </Modal>
  );
}

/** Compact completion ring for a checklist header. */
function MiniRing({ value, complete }: { value: number; complete: boolean }) {
  const r = 9, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 -rotate-90" aria-hidden>
      <circle cx="12" cy="12" r={r} fill="none" stroke="rgb(var(--c-ink) / 0.12)" strokeWidth="3" />
      <circle cx="12" cy="12" r={r} fill="none" stroke={complete ? 'rgb(var(--c-positive))' : 'rgb(var(--c-accent))'} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} style={{ transition: 'stroke-dashoffset 700ms var(--ease-out)' }} />
    </svg>
  );
}
