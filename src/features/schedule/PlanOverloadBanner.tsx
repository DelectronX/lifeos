import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Wand2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatDateKeyShort, formatDuration } from '@/lib/date';
import { getOverloadReport } from '@/services/planService';
import type { DayLoad, OverloadReport } from '@/engines/rescheduling';
import type { DateKey } from '@/types';

/**
 * Surfaces the ReschedulingEngine's overload detection.
 *
 * Renders nothing when the workload fits — a banner that is always on screen
 * stops being read. When it does appear it shows the engine's own message and
 * recommendations verbatim; no invented advice.
 */
export function PlanOverloadBanner({
  from, days = 7, refreshKey, onFix, className,
}: {
  from: DateKey;
  days?: number;
  /** Change this to force a recompute after the schedule changes. */
  refreshKey?: unknown;
  onFix?: () => void;
  className?: string;
}) {
  const [report, setReport] = useState<OverloadReport | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getOverloadReport(from, days);
        if (!cancelled) setReport(result);
      } catch {
        if (!cancelled) setReport(null);
      }
    })();
    return () => { cancelled = true; };
  }, [from, days, refreshKey]);

  const problems = report?.overloadedDays ?? [];
  const tight = (report?.days ?? []).filter((d) => d.severity === 'tight');

  if (!report || (problems.length === 0 && tight.length === 0)) return null;

  const worst = problems[0] ?? tight[0]!;
  const critical = problems.length > 0;

  return (
    <div
      className={cn(
        'rounded-card border px-3 py-2.5',
        critical ? 'border-critical/30 bg-critical/5' : 'border-caution/30 bg-caution/5',
        className,
      )}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', critical ? 'text-critical' : 'text-caution')} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">
            {critical
              ? `${problems.length} day${problems.length === 1 ? '' : 's'} over capacity`
              : `${tight.length} day${tight.length === 1 ? '' : 's'} with no slack`}
          </div>
          <p className="t-meta mt-0.5">{worst.message}</p>

          {expanded ? (
            <div className="mt-3 space-y-2.5">
              {[...problems, ...tight].map((day) => (
                <DayRow key={day.date} day={day} />
              ))}
              <p className="t-meta">{report.summary}</p>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onFix ? (
            <Button size="sm" iconLeft={<Wand2 className="h-3.5 w-3.5" />} onClick={onFix}>
              Rebalance
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            iconLeft={expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          >
            {expanded ? 'Less' : 'Details'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DayRow({ day }: { day: DayLoad }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{formatDateKeyShort(day.date)}</span>
        <span className="t-num text-2xs text-ink-muted">
          {formatDuration(day.demandMinutes)} planned / {formatDuration(day.capacityMinutes)} available
        </span>
        <Badge tone={day.severity === 'ok' ? 'neutral' : day.severity === 'tight' ? 'caution' : 'critical'}>
          {day.severity === 'impossible' ? 'Impossible' : day.severity === 'overloaded' ? 'Over capacity' : 'Tight'}
        </Badge>
      </div>
      {day.recommendations.length > 0 ? (
        <ul className="mt-1.5 list-inside list-disc space-y-0.5">
          {day.recommendations.map((r) => (
            <li key={r} className="t-meta">{r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
