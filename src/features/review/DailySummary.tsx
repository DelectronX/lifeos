import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCheck, Undo2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { undoPlanRun } from '@/services/planService';
import { formatDuration } from '@/lib/date';
import type { TriageOutcome } from './TaskTriageCard';
import type { DailyReviewMetrics } from '@/engines/analytics';

/**
 * The closing screen of the daily review: what happened, what was moved and
 * where it went. Each rescheduled item keeps its undo affordance so the user
 * can walk a decision back without leaving the review.
 */
export function DailySummary({
  metrics, outcomes, leftOpen, onReopen,
}: {
  metrics: DailyReviewMetrics;
  outcomes: readonly TriageOutcome[];
  leftOpen: number;
  onReopen: () => void;
}) {
  const [undone, setUndone] = useState<Record<string, boolean>>({});

  const moved = outcomes.filter((o) => o.strategy !== 'cancel' && o.strategy !== 'left_open');
  const cancelled = outcomes.filter((o) => o.strategy === 'cancel');

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center gap-2">
          <CheckCheck className="h-4 w-4 text-positive" />
          <h2 className="t-title">Day closed out</h2>
        </div>
        <p className="t-muted mt-2 leading-relaxed">{metrics.summary}</p>
        <ul className="t-meta mt-3 space-y-1">
          <li>
            {metrics.completedTasks.length} task{metrics.completedTasks.length === 1 ? '' : 's'} completed ·{' '}
            {formatDuration(metrics.minutesTracked)} tracked
            {metrics.plannedMinutes > 0 ? ` against ${formatDuration(metrics.plannedMinutes)} planned` : ''}.
          </li>
          <li>
            {moved.length} task{moved.length === 1 ? '' : 's'} rescheduled ·{' '}
            {cancelled.length} cancelled · {leftOpen} left open.
          </li>
        </ul>
      </Card>

      {outcomes.length === 0 ? (
        <Card>
          <p className="t-muted">
            Nothing was rescheduled during this review.
          </p>
        </Card>
      ) : (
        <section>
          <h3 className="t-title mb-2">What moved, and where</h3>
          <div className="space-y-2">
            {outcomes.map((o) => (
              <Card key={o.taskId} padded={false} className="px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{o.title}</span>
                      <Badge tone={o.strategy === 'cancel' ? 'critical' : 'accent'}>{o.label}</Badge>
                      {undone[o.taskId] ? <Badge tone="neutral">Undone</Badge> : null}
                    </div>
                    <p className="t-meta mt-1 leading-relaxed">{o.explanation}</p>
                    {o.placements.length > 0 ? (
                      <ul className="mt-1.5 space-y-0.5">
                        {o.placements.map((p) => (
                          <li key={p} className="t-num text-2xs text-ink-muted">{p}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {o.planRunId && !undone[o.taskId] ? (
                    <Button
                      size="xs"
                      iconLeft={<Undo2 className="h-3 w-3" />}
                      onClick={async () => {
                        const result = await undoPlanRun(o.planRunId!);
                        if (result.ok) setUndone((s) => ({ ...s, [o.taskId]: true }));
                        toast[result.ok ? 'success' : 'warning'](
                          result.ok ? 'Reverted' : 'Could not undo',
                          result.message,
                        );
                      }}
                    >
                      Undo
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onReopen}>Back to the review</Button>
        <Button variant="primary" iconLeft={<ArrowRight className="h-3.5 w-3.5" />}>
          <Link to="/schedule">Open tomorrow&apos;s schedule</Link>
        </Button>
      </div>
    </div>
  );
}
