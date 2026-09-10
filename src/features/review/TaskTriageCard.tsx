import { useCallback, useEffect, useState } from 'react';
import {
  CalendarPlus, ChevronRight, Hand, Scissors, SkipForward, Sparkles, Sunrise, XCircle,
} from 'lucide-react';
import { db } from '@/db/db';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { formatDuration, formatTime, relativeDayLabel } from '@/lib/date';
import {
  applyRescheduleOption, previewReschedule, undoPlanRun, type ReschedulePreview,
} from '@/services/planService';
import { ImpactPreview } from '@/features/schedule/PlanImpactPreview';
import { PlanRescheduleDialog } from '@/features/schedule/PlanRescheduleDialog';
import { ScheduleTaskModal } from '@/features/tasks/ScheduleTaskModal';
import type { RescheduleOption } from '@/engines/rescheduling';
import type { DateKey, ID, RescheduleStrategy, Task } from '@/types';

/**
 * One resolved task, kept so the closing summary can state exactly what moved
 * where — and so each change stays undoable after the fact.
 */
export interface TriageOutcome {
  taskId: ID;
  title: string;
  strategy: RescheduleStrategy | 'left_open' | 'other';
  label: string;
  /** The engine's own sentence, never a paraphrase. */
  explanation: string;
  /** Where the work landed, one line per created block. */
  placements: string[];
  planRunId: ID | null;
  undone: boolean;
}

/** The five headline actions the review offers, in the order they are shown. */
const QUICK_ACTIONS: { strategy: RescheduleStrategy; label: string; icon: typeof Sunrise }[] = [
  { strategy: 'tomorrow', label: 'Move to tomorrow', icon: Sunrise },
  { strategy: 'next_slot', label: 'Find next available slot', icon: CalendarPlus },
  { strategy: 'split', label: 'Split into sessions', icon: Scissors },
];

/**
 * Guided triage of a single incomplete task.
 *
 * Nothing here decides anything: `previewReschedule` runs the
 * ReschedulingEngine, the engine's explanation for the chosen option is shown
 * before the user confirms, and `applyRescheduleOption` records an undoable
 * plan run.
 */
export function TaskTriageCard({
  task, index, total, date, onResolved, onSkip,
}: {
  task: Task;
  index: number;
  total: number;
  date: DateKey;
  onResolved: (outcome: TriageOutcome) => void;
  onSkip: (task: Task) => void;
}) {
  const [preview, setPreview] = useState<ReschedulePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<RescheduleOption | null>(null);
  const [applying, setApplying] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [allOptionsOpen, setAllOptionsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPending(null);
    try {
      const result = await previewReschedule(task.id);
      if (!result) setError('This task no longer exists.');
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { void load(); }, [load]);

  const optionFor = (strategy: RescheduleStrategy): RescheduleOption | undefined =>
    preview?.proposal.options.find((o) => o.strategy === strategy);

  const confirm = async () => {
    if (!preview || !pending) return;
    setApplying(true);
    try {
      const result = await applyRescheduleOption(preview, pending);
      const placements = pending.proposedBlocks.map(
        (b) => `${relativeDayLabel(b.date, date)} ${formatTime(b.start)}–${formatTime(b.end)} (${b.durationMinutes} min)`,
      );
      toast.withAction(pending.label, pending.explanation, {
        label: 'Undo',
        onClick: async () => {
          const undo = await undoPlanRun(result.planRunId);
          toast[undo.ok ? 'success' : 'warning'](undo.ok ? 'Reverted' : 'Could not undo', undo.message);
        },
      });
      onResolved({
        taskId: task.id,
        title: task.title,
        strategy: pending.strategy,
        label: pending.label,
        explanation: pending.explanation,
        placements,
        planRunId: result.planRunId,
        undone: false,
      });
    } catch (e) {
      toast.error('Could not reschedule', e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const remaining = preview?.proposal.remaining;

  /**
   * After a change made outside this card (manual placement, or the full
   * option dialog) we read the task's blocks back from Dexie rather than
   * guessing, so the closing summary only states what is actually stored.
   */
  const outcomeFromStore = useCallback(async (
    strategy: TriageOutcome['strategy'], label: string, explanation: string,
  ): Promise<TriageOutcome> => {
    const blocks = await db.blocks.where('taskId').equals(task.id).toArray();
    const placements = blocks
      .filter((b) => b.status === 'planned' || b.status === 'in_progress')
      .sort((a, b) => a.start - b.start)
      .map((b) => `${relativeDayLabel(b.date, date)} ${formatTime(b.start)}–${formatTime(b.end)} (${Math.round((b.end - b.start) / 60_000)} min)`);
    return {
      taskId: task.id, title: task.title, strategy, label, explanation,
      placements, planRunId: null, undone: false,
    };
  }, [task.id, task.title, date]);

  const afterManual = async () => {
    const fresh = await db.tasks.get(task.id);
    const blocks = await db.blocks.where('taskId').equals(task.id).toArray();
    const stillOpen = blocks.every((b) => b.status !== 'planned' && b.status !== 'in_progress');
    if (!fresh || stillOpen) {
      // The modal was dismissed without saving — leave the task in the queue.
      return;
    }
    onResolved(await outcomeFromStore(
      'manual',
      'Scheduled manually',
      'You chose the day and time yourself; the block below is what was saved.',
    ));
  };

  const afterFullDialog = async () => {
    setAllOptionsOpen(false);
    onResolved(await outcomeFromStore(
      'other',
      'Rescheduled from the full option list',
      'Applied from the complete set of costed options; the placement below is what was saved.',
    ));
  };

  return (
    <>
      <Card className="border-accent/40">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="t-label">Task {index + 1} of {total}</span>
            <h3 className="t-title mt-1 break-words">{task.title}</h3>
          </div>
          <Button size="sm" iconLeft={<SkipForward className="h-3.5 w-3.5" />} onClick={() => onSkip(task)}>
            Leave it open
          </Button>
        </div>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
            Costing the options against your calendar…
          </div>
        ) : error || !preview ? (
          <div className="mt-4 space-y-3">
            <p className="t-muted">{error ?? 'Could not load reschedule options for this task.'}</p>
            <Button size="sm" onClick={() => void load()}>Try again</Button>
          </div>
        ) : pending ? (
          <ConfirmStep
            option={pending}
            preview={preview}
            applying={applying}
            onBack={() => setPending(null)}
            onConfirm={() => void confirm()}
          />
        ) : (
          <div className="mt-3 space-y-4">
            {remaining ? (
              <p className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink">
                {remaining.explanation}
              </p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              {QUICK_ACTIONS.map(({ strategy, label, icon: Icon }) => {
                const option = optionFor(strategy);
                const disabled = !option || Boolean(option.unavailableReason);
                const recommended = preview.proposal.recommended?.strategy === strategy;
                return (
                  <button
                    key={strategy}
                    type="button"
                    disabled={disabled}
                    onClick={() => option && setPending(option)}
                    className={`rounded-card border px-3 py-2.5 text-left transition-colors duration-150 ease-calm ${
                      disabled
                        ? 'cursor-not-allowed border-line bg-surface opacity-60'
                        : 'border-line bg-surface hover:border-accent'
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                      <span className="text-sm font-medium text-ink">{option?.label ?? label}</span>
                      {recommended && !disabled ? <Badge tone="accent">Recommended</Badge> : null}
                      {option && !option.unavailableReason && option.meetsDeadline ? (
                        <Badge tone="positive">Meets deadline</Badge>
                      ) : null}
                    </span>
                    <span className="t-meta mt-1 block">
                      {option?.unavailableReason ?? option?.explanation ?? 'Not available for this task.'}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setManualOpen(true)}
                className="rounded-card border border-line bg-surface px-3 py-2.5 text-left transition-colors duration-150 ease-calm hover:border-accent"
              >
                <span className="flex items-center gap-2">
                  <Hand className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  <span className="text-sm font-medium text-ink">Schedule manually</span>
                </span>
                <span className="t-meta mt-1 block">
                  Choose the day and time yourself; conflicts on that day are shown before it is saved.
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const option = optionFor('cancel');
                  if (option) setPending(option);
                }}
                className="rounded-card border border-line bg-surface px-3 py-2.5 text-left transition-colors duration-150 ease-calm hover:border-critical"
              >
                <span className="flex items-center gap-2">
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-critical" />
                  <span className="text-sm font-medium text-ink">Cancel the task</span>
                </span>
                <span className="t-meta mt-1 block">
                  {optionFor('cancel')?.explanation ?? 'Drop the remaining work.'}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setAllOptionsOpen(true)}
              className="t-meta inline-flex items-center gap-1 hover:text-ink"
            >
              <Sparkles className="h-3 w-3" />
              See all {preview.proposal.options.length} costed options
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </Card>

      <ScheduleTaskModal
        open={manualOpen}
        task={task}
        defaultDate={date}
        onClose={() => { setManualOpen(false); void afterManual(); }}
      />

      <PlanRescheduleDialog
        open={allOptionsOpen}
        taskId={allOptionsOpen ? task.id : null}
        onClose={() => setAllOptionsOpen(false)}
        onApplied={() => void afterFullDialog()}
      />
    </>
  );
}

/**
 * The confirmation step. It always shows the engine's explanation and a
 * before/after preview of the affected days before anything is written.
 */
function ConfirmStep({
  option, preview, applying, onBack, onConfirm,
}: {
  option: RescheduleOption;
  preview: ReschedulePreview;
  applying: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const destructive = option.strategy === 'cancel';
  return (
    <div className="mt-3 space-y-4">
      <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{option.label}</span>
          {option.coveredMinutes > 0 ? (
            <span className="t-num text-2xs text-ink-faint">{formatDuration(option.coveredMinutes)} covered</span>
          ) : null}
        </div>
        <p className="t-meta mt-1 leading-relaxed">{option.explanation}</p>
      </div>

      {option.displaces.length > 0 ? (
        <ul className="space-y-1">
          {option.displaces.map((d) => (
            <li key={d.blockId} className="rounded-md border border-caution/40 bg-surface px-3 py-2 text-xs text-ink">
              Displaces “{d.title}” — {d.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {option.proposedBlocks.length > 0 ? (
        <ImpactPreview existing={preview.context.blocks} proposals={option.proposedBlocks} />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onBack} disabled={applying}>Back</Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          loading={applying}
          onClick={onConfirm}
        >
          {destructive ? 'Cancel this task' : 'Apply'}
        </Button>
      </div>
    </div>
  );
}
