import { Link } from 'react-router-dom';
import { requestCompleteBlock } from '@/state/completeBlockStore';
import { SwapSlotButton } from './SwapSlotButton';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2, ChevronDown, Copy, ListPlus, MoreHorizontal, Play, Repeat, RotateCcw,
  Scissors, SkipForward, Trash2, X,
} from 'lucide-react';
import { Menu, type MenuItemSpec } from '@/components/ui/Menu';
import { useMediaQuery } from '@/lib/platform';
import { trackerHex } from './dayRibbon';
import { cn } from '@/lib/cn';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { toast } from '@/state/toastStore';
import {
  attachGoalToBlock, attachResourceToBlock, attachTaskToBlock, convertBlockToTask,
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
 * Block inspector — a drawer anchored between the header and the dock on
 * desktop (so it can never exceed the viewport), a bottom sheet below
 * 1024px. Header (inline-editable title, status, time), a scrolling body of
 * grouped sections with secondary ones collapsed, and a sticky action bar
 * with a "More" menu. Every control writes through scheduleService /
 * recurrenceService — nothing here touches Dexie directly.
 */
export function BlockInspector({
  block, onClose, onSelectBlock, onResolveOverrun, onRescheduleTask, className,
}: {
  block: ScheduleBlock;
  onClose: () => void;
  onSelectBlock?: (id: string) => void;
  /** "Ran over?" — opens the overrun resolver for this block. */
  onResolveOverrun?: (blockId: string) => void;
  onRescheduleTask?: (taskId: string) => void;
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
  const linked = !!(block.taskId || block.goalId || block.resourceId);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; focus moves into the panel when a block is opened.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || confirmDelete || scopeAsk) return;
      // An open menu/popover consumes Escape first (it closes itself).
      if (document.querySelector('[role="menu"]')) return;
      const t = e.target as HTMLElement | null;
      if (t && panelRef.current?.contains(t) && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) { t.blur(); return; }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmDelete, scopeAsk]);
  useEffect(() => { panelRef.current?.focus({ preventScroll: true }); }, [block.id]);

  const moreItems: MenuItemSpec[] = [
    { label: 'Duplicate', icon: <Copy className="h-3.5 w-3.5" />, onSelect: async () => { const copy = await duplicateBlock(block.id); if (copy) { toast.success('Duplicated'); onSelectBlock?.(copy.id); } } },
    { label: 'Copy to next day', icon: <CalendarPlus className="h-3.5 w-3.5" />, onSelect: async () => { const copy = await copyBlockToDate(block.id, addDaysToKey(block.date, 1)); if (copy) toast.success('Copied to tomorrow'); } },
    { label: 'Split in half', icon: <Scissors className="h-3.5 w-3.5" />, disabled: block.end - block.start < 20 * MINUTE_MS, onSelect: async () => {
      const halves = await splitBlock(block.id, block.start + Math.round((block.end - block.start) / 2));
      if (halves) toast.success('Split into two blocks'); else toast.warning('Block is too short to split');
    } },
    ...(!block.taskId ? [{ label: 'Make a task', icon: <ListPlus className="h-3.5 w-3.5" />, onSelect: async () => { const id = await convertBlockToTask(block.id); if (id) toast.success('Converted to a task', 'The block now tracks that task.'); } }] : []),
    ...(onResolveOverrun ? [{ label: 'Resolve overrun…', icon: <AlertTriangle className="h-3.5 w-3.5" />, hint: 'Ran over', separated: true, onSelect: () => onResolveOverrun(block.id) }] : []),
    ...(onRescheduleTask && block.taskId ? [{ label: 'Reschedule task…', icon: <CalendarClock className="h-3.5 w-3.5" />, onSelect: () => onRescheduleTask(block.taskId as string) }] : []),
    { label: 'Delete block', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, separated: true, onSelect: () => (isSeries ? setScopeAsk({ kind: 'delete' }) : setConfirmDelete(true)) },
  ];

  const panel = (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal={!desktop}
      aria-label={`Block: ${block.title}`}
      className={cn(
        'panel fixed z-[46] flex min-h-0 flex-col overflow-hidden focus:outline-none',
        desktop
          ? 'right-2 w-[min(24rem,calc(100vw-1rem))] rounded-[18px] animate-drawer'
          : 'inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] max-h-[82dvh] rounded-[20px] animate-in-sheet',
        className,
      )}
      style={desktop ? {
        top: 'calc(max(0.5rem, env(safe-area-inset-top)) + 3rem + 0.5rem)',
        bottom: 'calc(max(0.625rem, env(safe-area-inset-bottom)) + 3.5rem + 0.75rem)',
      } : undefined}
    >
      {!desktop ? <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-ink/20" aria-hidden /> : null}
      {/* Header */}
      <header className="flex shrink-0 items-start gap-3 px-4 pb-3 pt-3.5">
        <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: trackerHex(trackers.find((t) => t.id === block.trackerId)?.color) }} aria-hidden />
        <div className="min-w-0 flex-1">
          <input
            aria-label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title !== block.title && !isSeries) void updateBlock(block.id, { title: title.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="-mx-1 w-full truncate rounded-[6px] bg-transparent px-1 text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink hover:bg-ink/[0.05] focus:bg-ink/[0.06] focus:outline-none"
          />
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={block.status === 'completed' ? 'positive' : block.status === 'planned' ? 'neutral' : 'caution'}>
              {BLOCK_STATUS_LABELS[block.status]}
            </Badge>
            <span className="t-num text-[0.75rem] text-ink-muted">{formatDuration(minutes)} · {startTime}–{endLabel(date, startTime, minutes)}</span>
            {isSeries ? <Badge tone="accent"><Repeat className="h-2.5 w-2.5" /> Series</Badge> : null}
          </div>
        </div>
        <IconButton label="Close" size="sm" variant="ghost" onClick={onClose} className="-mr-1 shrink-0">
          <X className="h-4 w-4" />
        </IconButton>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line-faint px-4 pb-4">
        {isSeries && rule ? (
          <div className="mt-3 rounded-[10px] bg-accent/10 px-3 py-2">
            <div className="text-[0.75rem] font-medium text-accent-ink">{describeRule(rule)}</div>
            <div className="t-meta mt-0.5">Edits and deletions will ask which occurrences to apply to.</div>
          </div>
        ) : null}

        <InspectorSection title="Time">
          <div className="grid grid-cols-[1.3fr_1fr_0.8fr] gap-2">
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Start"><Input type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
            <Field label="Min"><Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
          </div>
          {dirtyTiming(block, date, startTime, minutes) ? (
            <div className="mt-2 flex items-center justify-between gap-2 animate-in-pop">
              <span className="t-meta">Ends {endLabel(date, startTime, minutes)}</span>
              <Button size="sm" variant="primary" onClick={commitTiming}>Apply timing</Button>
            </div>
          ) : null}
        </InspectorSection>

        <InspectorSection title="Activity">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Area">
              <Select value={block.trackerId} onChange={(e) => void updateBlock(block.id, { trackerId: e.target.value })}>
                {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Kind">
              <Select value={block.kind} onChange={(e) => void updateBlock(block.id, { kind: e.target.value as BlockKind })}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </Select>
            </Field>
          </div>
        </InspectorSection>

        <Disclosure title="Links" summary={linked ? [block.taskId && 'task', block.goalId && 'goal', block.resourceId && 'resource'].filter(Boolean).join(' · ') : 'Task, goal, resource'} defaultOpen={linked}>
          <Field label="Task" hint="Completion rolls up to real work.">
            <Select value={block.taskId ?? ''} onChange={(e) => void attachTaskToBlock(block.id, e.target.value || null)}>
              <option value="">None</option>
              {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </Field>
          <div className="mt-2 grid grid-cols-2 gap-2">
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
        </Disclosure>

        <InspectorSection title="Notes">
          <Textarea value={notes} rows={2} placeholder="Add a note…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (block.notes ?? '')) void updateBlock(block.id, { notes }); }} />
        </InspectorSection>

        <Disclosure title="Protection" summary={[block.locked && 'Locked', block.protected && 'Protected'].filter(Boolean).join(' · ') || 'Off'} defaultOpen={block.locked || block.protected}>
          <div className="space-y-3">
            <Toggle checked={block.locked} onChange={(v) => void setBlockLocked(block.id, v)} label="Locked" description="Pinned — drag, resize and engines cannot move it." />
            <Toggle checked={block.protected} onChange={(v) => void setBlockProtected(block.id, v)} label="Protected time" description="Engines never schedule work over it." />
          </div>
        </Disclosure>

        <InspectorSection title="Move">
          <div className="flex flex-wrap gap-2"><SwapSlotButton block={block} /></div>
        </InspectorSection>
      </div>

      {/* Sticky actions */}
      <footer className="flex shrink-0 items-center gap-2 border-t border-line-faint bg-surface-overlay px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:pb-2.5">
        {!closed ? (
          <>
            <Button size="sm" variant="primary" iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => void requestCompleteBlock(block)}>Complete</Button>
            {block.status === 'planned' ? (
              <Button size="sm" iconLeft={<Play className="h-3 w-3" />} onClick={async () => { await startBlock(block.id); toast.success('Started', 'It will be logged automatically when it ends.'); }}>Start</Button>
            ) : null}
            <Button size="sm" variant="ghost" iconLeft={<SkipForward className="h-3.5 w-3.5" />} onClick={async () => { await skipBlock(block.id, 'Skipped from inspector'); toast.success('Block skipped'); }}>Skip</Button>
          </>
        ) : (
          <Button size="sm" iconLeft={<RotateCcw className="h-3.5 w-3.5" />} onClick={async () => { await reopenBlock(block.id); toast.success('Block reopened'); }}>Reopen</Button>
        )}
        {block.paperId ? (
          <Link to={`/focus/paper/${block.paperId}`} className="inline-flex h-8 items-center rounded-full bg-accent/15 px-3 text-[0.8125rem] font-semibold text-accent-ink hover:bg-accent/25">Open paper</Link>
        ) : null}
        <div className="ml-auto">
          <Menu
            align="end"
            items={moreItems}
            trigger={({ toggle, ref, open }) => (
              <IconButton label="More actions" size="sm" variant="secondary" onClick={toggle} ref={ref as never} aria-expanded={open}>
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            )}
          />
        </div>
      </footer>

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
    </div>
  );

  return createPortal(
    <>
      {!desktop ? <div className="fixed inset-0 z-[45] bg-black/50 animate-fade" onClick={onClose} aria-hidden /> : null}
      {panel}
    </>,
    document.body,
  );
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-4">
      <h3 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

/** Progressive disclosure for secondary settings. */
function Disclosure({ title, summary, defaultOpen, children }: { title: string; summary: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="pt-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-[8px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-faint group-hover:text-ink-muted">{title}</h3>
        {!open ? <span className="min-w-0 flex-1 truncate text-[0.75rem] text-ink-faint">{summary}</span> : <span className="flex-1" />}
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-base', open && 'rotate-180')} />
      </button>
      {open ? <div className="mt-2 animate-in-pop">{children}</div> : null}
    </section>
  );
}

function dirtyTiming(block: ScheduleBlock, date: string, startTime: string, minutes: number): boolean {
  return date !== block.date || startTime !== hhmm(block.start) || minutes !== Math.round((block.end - block.start) / MINUTE_MS);
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
    <div className="shrink-0 border-t border-line-faint bg-surface-sunken px-4 py-3 animate-in-pop">
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
