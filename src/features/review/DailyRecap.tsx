import { CheckCircle2, Circle, Clock, Target } from 'lucide-react';
import { Card, EmptyState } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/Progress';
import { formatDuration, dueLabel } from '@/lib/date';
import { MetricTile, MinutesBars } from './ReviewParts';
import type { DailyReviewMetrics } from '@/engines/analytics';
import type { DateKey, Task } from '@/types';

/**
 * Step 1 of the daily close-out: what actually happened today.
 *
 * Every figure comes from `computeDailyReview` in the AnalyticsEngine. This
 * component only formats them.
 */
export function DailyRecap({ metrics, date }: { metrics: DailyReviewMetrics; date: DateKey }) {
  const { completedTasks, incompleteTasks, distribution } = metrics;

  const adherence = metrics.blocksPlanned > 0 ? metrics.blocksCompleted / metrics.blocksPlanned : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Tasks completed"
          value={completedTasks.length}
          evidence={`${incompleteTasks.length} still open from this day`}
        />
        <MetricTile
          label="Time tracked"
          value={formatDuration(metrics.minutesTracked)}
          evidence={
            metrics.plannedMinutes > 0
              ? `${formatDuration(metrics.plannedMinutes)} was planned`
              : 'Nothing was planned for this day'
          }
        />
        <MetricTile
          label="Blocks completed"
          value={metrics.blocksPlanned > 0 ? `${metrics.blocksCompleted}/${metrics.blocksPlanned}` : '—'}
          evidence={
            metrics.blocksPlanned === 0
              ? 'No schedule blocks for this day'
              : `${metrics.blocksSkipped} skipped${adherence !== null ? ` · ${Math.round(adherence * 100)}% of the plan done` : ''}`
          }
        />
        <MetricTile
          label="XP earned"
          value={metrics.xpEarned}
          evidence={`${metrics.revisionsCompleted} revision${metrics.revisionsCompleted === 1 ? '' : 's'} · ${metrics.habitCheckins} habit check-in${metrics.habitCheckins === 1 ? '' : 's'}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h3 className="t-title mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4 text-ink-faint" />
            Where the time went
          </h3>
          <Card>
            <MinutesBars
              rows={distribution.byTracker}
              emptyLabel="No tracked time on this day — no timer sessions or completed blocks were recorded."
            />
          </Card>
        </section>

        <section>
          <h3 className="t-title mb-2 flex items-center gap-2">
            <Target className="h-4 w-4 text-ink-faint" />
            Goal progress made
          </h3>
          {metrics.goalsTouched.length === 0 ? (
            <Card>
              <p className="t-muted">
                No tracked time was attributed to a goal on this day.
              </p>
            </Card>
          ) : (
            <Card className="space-y-3">
              {metrics.goalsTouched.map((g) => (
                <div key={g.goalId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs text-ink">{g.title}</span>
                    <span className="t-num text-2xs text-ink-muted">
                      +{formatDuration(g.minutes)} today
                    </span>
                  </div>
                  <ProgressBar value={g.progress} size="sm" />
                  <div className="t-meta mt-0.5">{Math.round(g.progress * 100)}% overall</div>
                </div>
              ))}
            </Card>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TaskColumn
          title="Completed"
          icon={<CheckCircle2 className="h-4 w-4 text-positive" />}
          tasks={completedTasks}
          date={date}
          emptyTitle="No tasks completed"
          emptyDescription="Nothing reached the completed state on this day."
          done
        />
        <TaskColumn
          title="Still open"
          icon={<Circle className="h-4 w-4 text-caution" />}
          tasks={incompleteTasks}
          date={date}
          emptyTitle="Nothing left open"
          emptyDescription="Every task on this day's plan was closed out."
        />
      </div>
    </div>
  );
}

function TaskColumn({
  title, icon, tasks, date, emptyTitle, emptyDescription, done,
}: {
  title: string;
  icon: React.ReactNode;
  tasks: readonly Task[];
  date: DateKey;
  emptyTitle: string;
  emptyDescription: string;
  done?: boolean;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h3 className="t-title">{title}</h3>
        <span className="t-num text-2xs text-ink-faint">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <Card padded={false} className="overflow-hidden">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <span className={`min-w-0 flex-1 truncate text-sm ${done ? 'text-ink-muted line-through' : 'text-ink'}`}>
                {t.title}
              </span>
              <span className="t-num shrink-0 text-2xs text-ink-faint">
                {done
                  ? formatDuration(t.actualMinutes || t.estimatedMinutes)
                  : formatDuration(Math.max(0, t.estimatedMinutes - t.actualMinutes))}
              </span>
              {!done && t.dueDate && t.dueDate < date ? (
                <Badge tone="critical">{dueLabel(t.dueDate, date)}</Badge>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
