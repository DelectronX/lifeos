import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Input } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import { formatDuration, formatTime, MINUTE_MS } from '@/lib/date';
import {
  applyConflictStrategy, previewConflict, undoPlanRun, type ConflictPreview,
} from '@/services/planService';
import { PlanDiff, TimeShift } from './PlanImpactPreview';
import type { ConflictStrategy } from '@/engines/conflictResolution';
import type { ID } from '@/types';

/**
 * Conflict dialog: "this block ran long — what happens to the rest of the day?"
 *
 * Shows every candidate strategy the ConflictResolutionEngine produced with its
 * plain-English `why`, a CURRENT vs PROPOSED diff, and the exact per-block
 * changes. Accept / Edit (change the real end time and recompute) / Cancel,
 * with Undo offered after applying.
 */
export function PlanConflictDialog({
  open, onClose, blockId, initialActualEnd, onApplied,
}: {
  open: boolean;
  onClose: () => void;
  blockId: ID | null;
  /** The block's real end. Defaults to "now" when the user reports an overrun. */
  initialActualEnd?: number;
  onApplied?: () => void;
}) {
  const [actualEnd, setActualEnd] = useState<number>(initialActualEnd ?? Date.now());
  const [preview, setPreview] = useState<ConflictPreview | null>(null);
  const [chosen, setChosen] = useState<ConflictStrategy | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const run = useCallback(async (end: number) => {
    if (!blockId) return;
    setLoading(true);
    try {
      const result = await previewConflict(blockId, end);
      setPreview(result);
      setChosen(result?.result.recommended ?? result?.result.strategies.find((s) => s.feasible) ?? null);
    } finally {
      setLoading(false);
    }
  }, [blockId]);

  useEffect(() => {
    if (!open || !blockId) { setPreview(null); setChosen(null); return; }
    const end = initialActualEnd ?? Date.now();
    setActualEnd(end);
    void run(end);
  }, [open, blockId, initialActualEnd, run]);

  const apply = async () => {
    if (!preview || !chosen) return;
    setApplying(true);
    try {
      const result = await applyConflictStrategy(preview, chosen);
      toast.withAction(
        chosen.label,
        `${result.updated} block${result.updated === 1 ? '' : 's'} changed${result.deleted ? `, ${result.deleted} moved off the day` : ''}.`,
        {
          label: 'Undo',
          onClick: async () => {
            const undo = await undoPlanRun(result.planRunId);
            toast[undo.ok ? 'success' : 'warning'](undo.ok ? 'Day restored' : 'Could not undo', undo.message);
          },
        },
      );
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error('Could not apply', e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const detection = preview?.result.detection;
  const strategies = preview?.result.strategies ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-caution" />
          {preview ? `"${preview.block.title}" ran over` : 'Resolve schedule conflict'}
        </span>
      }
      description="Pick how the rest of your day absorbs it. Nothing changes until you accept."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            loading={applying}
            disabled={!chosen || !chosen.feasible}
          >
            Accept {chosen ? `"${chosen.label}"` : 'plan'}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="It actually finished at" className="w-40">
          <Input
            type="time"
            value={hhmm(actualEnd)}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              const d = new Date(actualEnd);
              d.setHours(h || 0, m || 0, 0, 0);
              setActualEnd(d.getTime());
            }}
          />
        </Field>
        <Button size="sm" onClick={() => void run(actualEnd)} disabled={loading}>Recalculate</Button>
        {preview ? (
          <p className="t-meta flex-1 pb-1.5">
            Planned end {formatTime(preview.block.end)} · overran by{' '}
            {formatDuration(Math.max(0, (actualEnd - preview.block.end) / MINUTE_MS))}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-ink-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
          Working out the options…
        </div>
      ) : !preview ? null : (
        <>
          <p className="mb-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink">
            {detection?.summary}
          </p>

          {strategies.length === 0 ? (
            <p className="t-muted">
              No changes are needed — the overrun fits inside the tolerance or does not collide with
              anything downstream.
            </p>
          ) : (
            <>
              <div className="mb-4 space-y-2">
                {strategies.map((s) => (
                  <StrategyOption
                    key={s.kind}
                    strategy={s}
                    selected={chosen?.kind === s.kind}
                    recommended={preview.result.recommended?.kind === s.kind}
                    onSelect={() => s.feasible && setChosen(s)}
                  />
                ))}
              </div>

              {chosen ? (
                <>
                  <h4 className="t-label mb-2">
                    <Clock className="mr-1 inline h-3 w-3" />
                    {chosen.label} — before and after
                  </h4>
                  <PlanDiff
                    currentPlan={chosen.preview.currentPlan}
                    proposedPlan={chosen.preview.proposedPlan}
                  />
                  <ul className="mt-3 space-y-1">
                    {chosen.changes
                      .filter((c) => c.action !== 'unchanged')
                      .map((c) => (
                        <li key={c.blockId} className="rounded-md border border-line bg-surface px-3 py-1.5">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm text-ink">{c.title}</span>
                            <TimeShift from={c.from} to={c.to} />
                          </div>
                          <p className="t-meta mt-0.5">{c.reason}</p>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function StrategyOption({
  strategy, selected, recommended, onSelect,
}: {
  strategy: ConflictStrategy;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!strategy.feasible}
      className={cn(
        'w-full rounded-card border px-3 py-2.5 text-left transition-colors duration-150 ease-calm',
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
        !strategy.feasible && 'cursor-not-allowed opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{strategy.label}</span>
        {recommended ? <Badge tone="accent">Recommended</Badge> : null}
        {!strategy.feasible ? <Badge tone="critical">Not possible</Badge> : null}
        {strategy.respectsFixed ? <Badge tone="positive">Keeps fixed blocks</Badge> : null}
        {strategy.displacedBlockIds.length > 0 ? (
          <Badge tone="caution">{strategy.displacedBlockIds.length} pushed off the day</Badge>
        ) : null}
      </div>
      <p className="t-meta mt-1">{strategy.feasible ? strategy.why : strategy.infeasibleReason ?? strategy.why}</p>
    </button>
  );
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
