import { useEffect, useState } from 'react';
import {
  CheckCircle2, Copy, Repeat, RotateCcw, Scissors, SkipForward, Trash2, X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { toast } from '@/state/toastStore';
import {
  attachGoalToBlock, attachResourceToBlock, attachTaskToBlock, completeBlock, convertBlockToTask,
  copyBlockToDate, deleteBlock, duplicateBlock, reopenBlock, setBlockLocked, setBlockProtected,
  skipBlock, splitBlock, startBlock, updateBlock,
} from '@/services/scheduleService';
import { deleteFromSeries, describeRule, editSeries } from '@/services/recurrenceService';
import {
  addDaysToKey, atMinute, formatDuration, MINUTE_MS, minuteOfDay, toDateKey,
} from '@/lib/date';
import { useGoals, useOpenTasks, useRecurringRule, useResources, useTrackers } from '@/state/useLiveData';
import { BLOCK_STATUS_LABELS, KIND_LABELS } from './blockStyles';
import type { BlockKind, RecurrenceEditScope, ScheduleBlock } from '@/types';

const KINDS: BlockKind[] = ['task', 'fixed', 'break', 'buffer', 'sleep', 'meal', 'event'];

/**
 * Right-hand inspector for a single block. Every control writes through
 * scheduleService / recurrenceService — nothing here touches Dexie directly.
 */
export function BlockInspector({
  block, onClose, onSelectBlock, className,
}: {
  block: ScheduleBlock;
  onClose: () => void;
  onSelectBlock?: (id: string) => void;
  className?: string;
}) {
  const trackers = useTrackers();
  const goals = useGoals(true);
  const openTasks = useOpenTasks();
  const resources = useResources();
  const rule = useRecurringRule(block.recurringRuleId ?? null);

  const [title, setTitle] = useState(block.title);
  const [notes, setNotes] = useState(block.notes ?? '');
  const [startTime, setStartTime] = useState(() => hhmm(block.start));
  const [duration, setDuration] = useState(() => String(Math.round((block.end - block.start) / MINUTE_MS)));
  const [date, setDate] = useState(block.date);
  const [scopeAsk, setScopeAsk] = useState<null | { kind: 'edit' | 'delete' }>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(block.title);
    setNotes(block.notes ?? '');
    setStartTime(hhmm(block.start));
    setDuration(String(Math.round((block.end - block.start) / MINUTE_MS)));
    setDate(block.date);
  }, [block.id, block.start, block.end, block.title, block.notes, block.date]);

  const isSeries = !!block.recurringRuleId && !block.detachedFromSeries;
  const minutes = Math.max(5, Number(duration) || 5);

  const commitTiming = async () => {
    const [h, m] = startTime.split(':').map(Number);
    const start = atMinute(date, (h || 0) * 60 + (m || 0));
    if (isSeries) { setScopeAsk({ kind: 'edit' }); return; }
    await updateBlock(block.id, { start, end: start + minutes * MINUTE_MS });
    toast.success('Block updated');
  };

  const applyScopedEdit = async (scope: RecurrenceEditScope) => {
    const [h, m] = startTime.split(':').map(Number);
    if (!block.recurringRuleId) return;
    const message = await editSeries(
      block.recurringRuleId,
      block.occurrenceDate ?? block.date,
      scope,
      { title: title.trim() || block.title, startMinute: (h || 0) * 60 + (m || 0), durationMinutes: minutes, notes },
    );
    toast.success('Series updated', message);
    setScopeAsk(null);
    onClose();
  };

  const applyScopedDelete = async (scope: RecurrenceEditScope) => {
    if (!block.recurringRuleId) return;
    const message = await deleteFromSeries(block.recurringRuleId, block.occurrenceDate ?? block.date, scope);
    toast.success('Occurrence removed', message);
    setScopeAsk(null);
    onClose();
  };

  const closed = block.status === 'completed' || block.status === 'cancelled' || block.status === 'skipped';

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 flex-col rounded-card border border-line bg-surface-raised',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="t-section truncate">{block.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={block.status === 'completed' ? 'positive' : block.status === 'planned' ? 'neutral' : 'caution'}>
              {BLOCK_STATUS_LABELS[block.status]}
            </Badge>
            <Badge tone="outline">{KIND_LABELS[block.kind]}</Badge>
            {isSeries ? <Badge tone="accent"><Repeat className="h-2.5 w-2.5" /> Series</Badge> : null}
          </div>
        </div>
        <IconButton label="Close inspector" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {isSeries && rule ? (
          <div className="rounded-lg border border-accent/20 bg-accent-soft/50 px-3 py-2">
            <div className="text-xs font-medium text-accent-ink">{describeRule(rule)}</div>
            <div className="t-meta mt-0.5">Edits and deletions will ask which occurrences to apply to.</div>
          </div>
        ) : null}

        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => {
            if (title.trim() && title !== block.title && !isSeries) void updateBlock(block.id, { title: title.trim() });
          }} />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start">
            <Input type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="t-meta">{formatDuration(minutes)} · ends {endLabel(date, startTime, minutes)}</span>
          <Button size="sm" variant="primary" onClick={commitTiming}>Apply timing</Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tracker">
            <Select
              value={block.trackerId}
              onChange={(e) => void updateBlock(block.id, { trackerId: e.target.value })}
            >
              {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Kind">
            <Select
              value={block.kind}
              onChange={(e) => void updateBlock(block.id, { kind: e.target.value as BlockKind })}
            >
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Attached task" hint="Links the block to real work so completion rolls up.">
          <Select
            value={block.taskId ?? ''}
            onChange={(e) => void attachTaskToBlock(block.id, e.target.value || null)}
          >
            <option value="">None</option>
            {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Goal">
            <Select value={block.goalId ?? ''} onChange={(e) => void attachGoalToBlock(block.id, e.target.value || null)}>
              <option value="">None</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </Select>
          </Field>
          <Field label="Resource">
            <Select value={block.resourceId ?? ''} onChange={(e) => void attachResourceToBlock(block.id, e.target.value || null)}>
              <option value="">None</option>
              {resources.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Notes">
          <Textarea
            value={notes}
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (block.notes ?? '')) void updateBlock(block.id, { notes }); }}
          />
        </Field>

        <div className="space-y-3 rounded-lg border border-line px-3 py-3">
          <Toggle
            checked={block.locked}
            onChange={(v) => void setBlockLocked(block.id, v)}
            label="Locked"
            description="Pinned in place — drag, resize and engines cannot move it."
          />
          <Toggle
            checked={block.protected}
            onChange={(v) => void setBlockProtected(block.id, v)}
            label="Protected time"
            description="Engines will never schedule work over this block."
          />
        </div>

        <div className="space-y-2">
          <div className="t-label">Actions</div>
          <div className="grid grid-cols-2 gap-2">
            {!closed ? (
              <>
                <Button
                  size="sm"
                  iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />}
                  onClick={async () => { await completeBlock(block.id); toast.success('Block completed'); }}
                >
                  Complete
                </Button>
                <Button
                  size="sm"
                  iconLeft={<SkipForward className="h-3.5 w-3.5" />}
                  onClick={async () => { await skipBlock(block.id, 'Skipped from inspector'); toast.success('Block skipped'); }}
                >
                  Skip
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={async () => { await reopenBlock(block.id); toast.success('Block reopened'); }}
              >
                Reopen
              </Button>
            )}

            {block.status === 'planned' ? (
              <Button size="sm" onClick={async () => { await startBlock(block.id); toast.success('Started'); }}>
                Start now
              </Button>
            ) : null}

            <Button
              size="sm"
              iconLeft={<Copy className="h-3.5 w-3.5" />}
              onClick={async () => {
                const copy = await duplicateBlock(block.id);
                if (copy) { toast.success('Duplicated'); onSelectBlock?.(copy.id); }
              }}
            >
              Duplicate
            </Button>

            <Button
              size="sm"
              onClick={async () => {
                const copy = await copyBlockToDate(block.id, addDaysToKey(block.date, 1));
                if (copy) toast.success('Copied to tomorrow');
              }}
            >
              Copy to next day
            </Button>

            <Button
              size="sm"
              iconLeft={<Scissors className="h-3.5 w-3.5" />}
              disabled={block.end - block.start < 20 * MINUTE_MS}
              onClick={async () => {
                const halves = await splitBlock(block.id, block.start + Math.round((block.end - block.start) / 2));
                if (halves) toast.success('Split into two blocks');
                else toast.warning('Block is too short to split');
              }}
            >
              Split in half
            </Button>

            {!block.taskId ? (
              <Button
                size="sm"
                onClick={async () => {
                  const id = await convertBlockToTask(block.id);
                  if (id) toast.success('Converted to a task', 'The block now tracks that task.');
                }}
              >
                Make a task
              </Button>
            ) : null}

            <Button
              size="sm"
              variant="danger"
              iconLeft={<Trash2 className="h-3.5 w-3.5" />}
              className="col-span-2"
              onClick={() => (isSeries ? setScopeAsk({ kind: 'delete' }) : setConfirmDelete(true))}
            >
              Delete block
            </Button>
          </div>
        </div>
      </div>

      {scopeAsk ? (
        <ScopePrompt
          mode={scopeAsk.kind}
          onCancel={() => setScopeAsk(null)}
          onPick={(scope) => (scopeAsk.kind === 'edit' ? applyScopedEdit(scope) : applyScopedDelete(scope))}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        confirmLabel="Delete"
        title="Delete this block?"
        message="The block is removed from the schedule. Any completed activity already recorded is kept."
        onConfirm={async () => { await deleteBlock(block.id); toast.success('Block deleted'); onClose(); }}
      />
    </aside>
  );
}

/** "This occurrence / this and future / entire series" chooser. */
function ScopePrompt({
  mode, onPick, onCancel,
}: {
  mode: 'edit' | 'delete';
  onPick: (scope: RecurrenceEditScope) => void;
  onCancel: () => void;
}) {
  const verb = mode === 'edit' ? 'Change' : 'Delete';
  return (
    <div className="border-t border-line bg-surface-sunken px-4 py-3">
      <div className="t-section">{verb} recurring block</div>
      <p className="t-meta mt-0.5">Which occurrences should this apply to?</p>
      <div className="mt-3 space-y-1.5">
        <Button fullWidth size="sm" onClick={() => onPick('occurrence')}>This occurrence only</Button>
        <Button fullWidth size="sm" onClick={() => onPick('future')}>This and all future</Button>
        <Button fullWidth size="sm" variant={mode === 'delete' ? 'danger' : 'secondary'} onClick={() => onPick('series')}>
          Entire series
        </Button>
        <Button fullWidth size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function hhmm(ts: number): string {
  const m = minuteOfDay(ts);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function endLabel(date: string, startTime: string, minutes: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const end = atMinute(date, (h || 0) * 60 + (m || 0) + minutes);
  const endDate = toDateKey(end);
  const em = minuteOfDay(end);
  const label = `${String(Math.floor(em / 60)).padStart(2, '0')}:${String(em % 60).padStart(2, '0')}`;
  return endDate === date ? label : `${label} (${endDate})`;
}
