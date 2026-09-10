import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import { formatDateKeyShort, formatDuration } from '@/lib/date';
import {
  applyAutoPlan, previewAutoPlan, undoPlanRun,
  type AutoPlanPreview,
} from '@/services/planService';
import { ImpactPreview, useSelection } from './PlanImpactPreview';
import type { DateKey } from '@/types';

/**
 * "Auto-plan day" flow: run the SchedulingEngine, show the impact preview with
 * per-task reasons and the unplaced list, then Accept / Edit / Cancel.
 *
 * "Edit" is not a separate mode — the preview's checkboxes ARE the edit
 * affordance, so the user can drop individual proposals and accept the rest.
 * After applying, an Undo toast reverts the whole run.
 */
export function PlanPanel({
  open, onClose, date, onApplied,
}: {
  open: boolean;
  onClose: () => void;
  date: DateKey;
  onApplied?: () => void;
}) {
  const [days, setDays] = useState(1);
  const [preview, setPreview] = useState<AutoPlanPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { selected, reset, toggle } = useSelection([]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await previewAutoPlan({ from: date, days });
      setPreview(result);
      reset(result.result.proposals.map((p) => p.tempId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setLoading(false);
    }
    // `reset` is a stable-enough setter wrapper; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, days]);

  useEffect(() => {
    if (open) void run();
    else setPreview(null);
  }, [open, run]);

  const accept = async () => {
    if (!preview) return;
    setApplying(true);
    try {
      const result = await applyAutoPlan(preview, [...selected]);
      if (result.created === 0) {
        toast.warning('Nothing applied', 'No proposals were selected.');
      } else {
        toast.withAction(
          `Scheduled ${result.created} block${result.created === 1 ? '' : 's'}`,
          preview.summary,
          {
            label: 'Undo',
            onClick: async () => {
              const undo = await undoPlanRun(result.planRunId);
              toast[undo.ok ? 'success' : 'warning'](undo.ok ? 'Change reverted' : 'Could not undo', undo.message);
            },
          },
        );
        onApplied?.();
        onClose();
      }
    } catch (e) {
      toast.error('Could not apply the plan', e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const proposals = preview?.result.proposals ?? [];
  const selectedMinutes = proposals
    .filter((p) => selected.has(p.tempId))
    .reduce((s, p) => s + p.durationMinutes, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          Auto-plan {days === 1 ? formatDateKeyShort(date) : `${days} days from ${formatDateKeyShort(date)}`}
        </span>
      }
      description="Nothing is saved until you accept. Untick anything you do not want."
      footer={
        <>
          <span className="mr-auto text-xs text-ink-muted">
            {selected.size} of {proposals.length} proposals selected
            {selectedMinutes > 0 ? ` · ${formatDuration(selectedMinutes)}` : ''}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => void run()} disabled={loading}>Re-run</Button>
          <Button
            variant="primary"
            onClick={() => void accept()}
            loading={applying}
            disabled={selected.size === 0 || loading}
          >
            Accept plan
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Plan across" className="w-40">
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            <option value="1">Just this day</option>
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
          </Select>
        </Field>
        <p className="t-meta flex-1 pb-1.5">
          Tasks already on the calendar are left alone. Placement respects protected and locked
          blocks, hard deadlines, your working hours, preferred windows and the daily load ceiling.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-ink-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
          Working out the best arrangement…
        </div>
      ) : error ? (
        <div className="rounded-card border border-critical/30 bg-critical/5 p-4 text-sm text-critical">
          {error}
        </div>
      ) : preview ? (
        <>
          <p className="mb-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink">
            {preview.summary}
          </p>
          <ImpactPreview
            existing={preview.existingBlocks}
            proposals={preview.result.proposals}
            placements={preview.result.placements}
            unplaced={preview.result.unplaced}
            selected={selected}
            onToggle={toggle}
          />
        </>
      ) : null}
    </Modal>
  );
}

/**
 * Standalone "Undo last automated change" control. Reads the most recent
 * non-undone PlanRun so the affordance persists past the toast timeout.
 */
export function UndoLastChangeButton({
  runId, explanation, onUndone,
}: {
  runId: string;
  explanation: string[];
  onUndone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      iconLeft={<Undo2 className="h-3.5 w-3.5" />}
      loading={busy}
      title={explanation[0] ?? 'Revert the last automated change'}
      onClick={async () => {
        setBusy(true);
        const result = await undoPlanRun(runId);
        toast[result.ok ? 'success' : 'warning'](result.ok ? 'Change reverted' : 'Could not undo', result.message);
        setBusy(false);
        if (result.ok) onUndone?.();
      }}
    >
      Undo last change
    </Button>
  );
}
