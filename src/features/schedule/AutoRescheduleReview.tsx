import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import { formatDuration, formatTime, relativeDayLabel } from '@/lib/date';
import { applyAutoReschedule, undoPlanRun } from '@/services/planService';
import { useAutoRescheduleStore } from '@/state/autoRescheduleStore';

/**
 * "suggest" mode review — every decision the full-auto engine would take,
 * shown with its explanation, tickable so the user can drop individual
 * tasks before accepting. Nothing is written until Accept is pressed.
 */
export function AutoRescheduleReviewDialog() {
  const preview = useAutoRescheduleStore((s) => s.preview);
  const open = useAutoRescheduleStore((s) => s.dialogOpen);
  const close = useAutoRescheduleStore((s) => s.closeReviewDialog);
  const refreshSlippedCount = useAutoRescheduleStore((s) => s.refreshSlippedCount);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [applying, setApplying] = useState(false);

  const decisions = preview?.result.decisions ?? [];
  const needsUserInput = preview?.result.needsUserInput ?? [];

  const allIds = useMemo(() => decisions.map((d) => d.taskId), [decisions]);
  // Reset selection whenever a new preview arrives.
  const key = preview ? decisions.map((d) => d.taskId).join(',') : '';
  const [lastKey, setLastKey] = useState('');
  if (key !== lastKey) {
    setLastKey(key);
    setSelected(new Set(allIds));
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const accept = async () => {
    if (!preview) return;
    setApplying(true);
    try {
      const accepted = [...selected];
      if (accepted.length === 0) {
        toast.warning('Nothing applied', 'No proposals were selected.');
        close();
        return;
      }
      const result = await applyAutoReschedule(preview, accepted);
      if (result.planRunId) {
        toast.withAction(
          `Rescheduled ${result.updated} task${result.updated === 1 ? '' : 's'}`,
          result.explanation.join(' '),
          {
            label: 'Undo',
            onClick: async () => {
              const undo = await undoPlanRun(result.planRunId);
              toast[undo.ok ? 'success' : 'warning'](undo.ok ? 'Reverted' : 'Could not undo', undo.message);
              await refreshSlippedCount();
            },
          },
        );
      }
      await refreshSlippedCount();
      close();
    } catch (e) {
      toast.error('Could not reschedule', e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-accent" />
          Tasks that slipped
        </span>
      }
      description="Every proposal below was costed against your real calendar. Untick anything you don't want; nothing moves until you accept."
      footer={
        <>
          <Button onClick={close}>Not now</Button>
          <Button
            variant="primary"
            loading={applying}
            disabled={selected.size === 0}
            onClick={() => void accept()}
          >
            Accept {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </>
      }
    >
      {decisions.length === 0 && needsUserInput.length === 0 ? (
        <p className="t-meta py-6 text-center">Nothing needs rescheduling.</p>
      ) : (
        <div className="space-y-2">
          {decisions.map((d) => (
            <div
              key={d.taskId}
              className="rounded-card border border-line bg-surface px-3 py-2.5"
            >
              <div className="flex items-start gap-2.5">
                <Checkbox
                  checked={selected.has(d.taskId)}
                  onChange={() => toggle(d.taskId)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">{d.title}</span>
                    <Badge tone="neutral">{d.strategy.replace('_', ' ')}</Badge>
                  </div>
                  <p className="t-meta mt-1">{d.explanation}</p>
                  {d.proposedBlocks.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {d.proposedBlocks.map((b) => (
                        <li key={b.tempId} className="t-num text-2xs text-ink-muted">
                          {relativeDayLabel(b.date)} {formatTime(b.start)}–{formatTime(b.end)} ·{' '}
                          {formatDuration(b.durationMinutes)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          {needsUserInput.length > 0 ? (
            <div>
              <h4 className="t-label mb-2 mt-4 inline-flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-caution" />
                Needs your decision ({needsUserInput.length})
              </h4>
              <ul className="space-y-1.5">
                {needsUserInput.map((n) => (
                  <li key={n.taskId} className="rounded-md border border-caution/30 bg-caution/5 px-3 py-2">
                    <div className="text-sm font-medium text-ink">{n.title}</div>
                    <p className="t-meta mt-0.5">{n.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/**
 * "N tasks need rescheduling" entry point for Home / Daily Review. Only
 * renders when there is something to show; clicking opens the review dialog
 * regardless of the configured mode (this is always a manual check).
 */
export function SlippedTasksBanner({ className }: { className?: string }) {
  const count = useAutoRescheduleStore((s) => s.slippedCount);
  const checking = useAutoRescheduleStore((s) => s.checking);
  const openReviewDialog = useAutoRescheduleStore((s) => s.openReviewDialog);

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => void openReviewDialog()}
      disabled={checking}
      className={
        'flex w-full items-center gap-2.5 rounded-card border border-caution/30 bg-caution/5 px-3.5 py-2.5 text-left transition-colors duration-150 ease-calm hover:border-caution/50 disabled:opacity-60' +
        (className ? ` ${className}` : '')
      }
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-caution" />
      <span className="flex-1 text-sm text-ink">
        {count} task{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} rescheduling
      </span>
      <span className="t-meta">Review</span>
    </button>
  );
}
