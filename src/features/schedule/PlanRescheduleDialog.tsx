import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/state/toastStore';
import { formatDuration, formatTime, relativeDayLabel } from '@/lib/date';
import {
  applyRescheduleOption, getDurationHint, previewReschedule, undoPlanRun,
  type ReschedulePreview,
} from '@/services/planService';
import type { RescheduleOption } from '@/engines/rescheduling';
import type { DurationPrediction } from '@/engines/durationPrediction';
import type { ID } from '@/types';

/**
 * Per-task rescheduling. Presents every option the engine costed — next slot,
 * tomorrow, split, shrink, displace, manual, cancel — each with the reason it
 * is or is not available, then applies exactly one, undoably.
 */
export function PlanRescheduleDialog({
  open, onClose, taskId, onApplied,
}: {
  open: boolean;
  onClose: () => void;
  taskId: ID | null;
  onApplied?: () => void;
}) {
  const [preview, setPreview] = useState<ReschedulePreview | null>(null);
  const [chosen, setChosen] = useState<RescheduleOption | null>(null);
  const [hint, setHint] = useState<DurationPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const run = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const result = await previewReschedule(taskId);
      setPreview(result);
      setChosen(result?.proposal.recommended ?? null);
      setHint(await getDurationHint(taskId));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (open && taskId) void run();
    else { setPreview(null); setChosen(null); setHint(null); }
  }, [open, taskId, run]);

  const apply = async () => {
    if (!preview || !chosen) return;
    if (chosen.strategy === 'manual') {
      toast.show('Pick a time yourself', 'Close this and drag the task onto the schedule where you want it.');
      onClose();
      return;
    }
    setApplying(true);
    try {
      const result = await applyRescheduleOption(preview, chosen);
      toast.withAction(chosen.label, chosen.explanation, {
        label: 'Undo',
        onClick: async () => {
          const undo = await undoPlanRun(result.planRunId);
          toast[undo.ok ? 'success' : 'warning'](undo.ok ? 'Reverted' : 'Could not undo', undo.message);
        },
      });
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error('Could not reschedule', e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const remaining = preview?.proposal.remaining;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-accent" />
          Reschedule {preview ? `"${preview.task.title}"` : 'task'}
        </span>
      }
      description="Every option below was costed against your real calendar. Nothing moves until you accept."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={applying}
            disabled={!chosen || Boolean(chosen.unavailableReason)}
            onClick={() => void apply()}
          >
            Accept
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-ink-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
          Costing your options…
        </div>
      ) : !preview ? null : (
        <>
          <p className="mb-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink">
            {remaining?.explanation}
          </p>

          {hint ? <DurationHint prediction={hint} className="mb-3" /> : null}

          <div className="space-y-2">
            {preview.proposal.options.map((option) => (
              <OptionRow
                key={option.strategy}
                option={option}
                selected={chosen?.strategy === option.strategy}
                recommended={preview.proposal.recommended?.strategy === option.strategy}
                onSelect={() => !option.unavailableReason && setChosen(option)}
              />
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function OptionRow({
  option, selected, recommended, onSelect,
}: {
  option: RescheduleOption;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  const disabled = Boolean(option.unavailableReason);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'w-full rounded-card border px-3 py-2.5 text-left transition-colors duration-150 ease-calm',
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{option.label}</span>
        {recommended ? <Badge tone="accent">Recommended</Badge> : null}
        {disabled ? <Badge tone="neutral">Unavailable</Badge> : null}
        {!disabled && option.meetsDeadline ? <Badge tone="positive">Meets deadline</Badge> : null}
        {!disabled && !option.meetsDeadline && option.coveredMinutes > 0 ? (
          <Badge tone="caution">Misses the deadline</Badge>
        ) : null}
        {option.coveredMinutes > 0 ? (
          <span className="t-num text-2xs text-ink-faint">{formatDuration(option.coveredMinutes)}</span>
        ) : null}
      </div>
      <p className="t-meta mt-1">{option.explanation}</p>
      {option.proposedBlocks.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {option.proposedBlocks.map((b) => (
            <li key={b.tempId} className="t-num text-2xs text-ink-muted">
              {relativeDayLabel(b.date)} {formatTime(b.start)}–{formatTime(b.end)} · {b.durationMinutes} min
            </li>
          ))}
        </ul>
      ) : null}
    </button>
  );
}

/**
 * Non-binding duration hint from the DurationPredictionEngine. Deliberately
 * advisory: it renders the pattern and a suggested range, and offers an
 * explicit "use this" callback — it never writes anything itself.
 */
export function DurationHint({
  prediction, onApply, className,
}: {
  prediction: DurationPrediction;
  onApply?: (minutes: number) => void;
  className?: string;
}) {
  if (prediction.sampleSize < 1) return null;
  const s = prediction.suggestion;
  return (
    <div className={cn('rounded-card border border-line bg-surface-sunken px-3 py-2', className)}>
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-caution" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-label">Based on your history</span>
            <Badge tone="neutral">{prediction.confidence} confidence</Badge>
            <span className="t-num text-2xs text-ink-faint">{prediction.sampleSize} samples</span>
          </div>
          <p className="t-meta mt-1">{prediction.pattern}</p>
          {s && onApply ? (
            <Button
              size="xs"
              className="mt-2"
              onClick={() => onApply(s.likelyMinutes)}
            >
              Use {s.likelyMinutes} min instead
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
