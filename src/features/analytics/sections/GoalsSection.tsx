import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/Progress';
import { DataTable, type Column } from '@/components/charts/DataTable';
import { formatDateKeyShort } from '@/lib/date';
import type { GoalMetrics, GoalRollupRow } from '@/engines/analytics';
import {
  AnalyticsSection, InsightNote, NoData, StatCard, StatGrid, mins, pct,
} from '../components/AnalyticsPrimitives';

/**
 * Goals answers: which goals are moving, which have stalled, and are they on
 * pace? "Behind" is the engine's linear expectation against elapsed time — it
 * is stated with its numbers, never as a verdict.
 */
export function GoalsSection({ goals }: { goals: GoalMetrics }) {
  const active = goals.rows.filter((r) => r.status === 'active');
  const advancing = active.filter((r) => r.minutesInPeriod > 0 || r.tasksCompletedInPeriod > 0);
  const stalled = active.filter((r) => r.minutesInPeriod === 0 && r.tasksCompletedInPeriod === 0);

  const columns: Column<GoalRollupRow>[] = [
    {
      key: 'title',
      header: 'Goal',
      primary: true,
      cell: (r) => (
        <Link to={`/goals/${r.goalId}`} className="text-ink hover:underline underline-offset-4">
          {r.title}
        </Link>
      ),
    },
    { key: 'tracker', header: 'Tracker', cell: (r) => <span className="t-meta">{r.trackerLabel}</span> },
    {
      key: 'progress',
      header: 'Progress',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          <ProgressBar value={r.progress} size="xs" className="w-16" />
          <span className="t-num text-xs">{pct(r.progress)}</span>
        </div>
      ),
    },
    {
      key: 'pace',
      header: 'Pace',
      align: 'right',
      cell: (r) =>
        r.behindBy === null ? (
          <span className="t-meta">No target date</span>
        ) : r.behindBy > 0.15 ? (
          <Badge tone="critical">{pct(r.behindBy)} behind</Badge>
        ) : r.behindBy > 0 ? (
          <Badge tone="caution">{pct(r.behindBy)} behind</Badge>
        ) : (
          <Badge tone="positive">On or ahead</Badge>
        ),
    },
    {
      key: 'effort',
      header: 'This period',
      align: 'right',
      cell: (r) =>
        r.minutesInPeriod === 0 && r.tasksCompletedInPeriod === 0 ? (
          <span className="t-meta">No activity</span>
        ) : (
          <span className="t-num">
            {mins(r.minutesInPeriod)}
            {r.tasksCompletedInPeriod > 0 ? ` · ${r.tasksCompletedInPeriod} task${r.tasksCompletedInPeriod === 1 ? '' : 's'}` : ''}
          </span>
        ),
    },
    {
      key: 'due',
      header: 'Target',
      align: 'right',
      cell: (r) =>
        r.targetDate === null ? (
          <span className="t-meta">—</span>
        ) : (
          <span className="t-num text-xs">
            {formatDateKeyShort(r.targetDate)}
            {r.daysRemaining !== null ? (
              <span className="text-ink-faint"> ({r.daysRemaining >= 0 ? `${r.daysRemaining}d left` : `${-r.daysRemaining}d over`})</span>
            ) : null}
          </span>
        ),
    },
  ];

  if (goals.rows.length === 0) {
    return (
      <AnalyticsSection title="Goals" question="Which goals are advancing?">
        <NoData
          icon={<Target className="h-7 w-7" />}
          title="No goals created yet"
          action="Create a goal and attach tasks or time to it — progress, pace and stalled detection all derive from those records."
        />
      </AnalyticsSection>
    );
  }

  return (
    <>
      <AnalyticsSection title="Goal portfolio" question="How the whole set of goals stands right now.">
        <StatGrid>
          <StatCard label="Active" value={goals.active} sub={`${goals.completed} completed · ${goals.paused} paused`} />
          <StatCard label="Weighted progress" value={pct(goals.weightedProgress)} sub={`Mean ${pct(goals.meanProgress)} across active goals`} />
          <StatCard
            label="Advancing this period"
            value={advancing.length}
            sub={`${stalled.length} active goal${stalled.length === 1 ? '' : 's'} saw no activity`}
            tone={advancing.length === 0 && active.length > 0 ? 'critical' : 'default'}
          />
          <StatCard
            label="Finished this period"
            value={goals.completedInPeriod}
            sub={`${goals.milestonesCompletedInPeriod} milestone${goals.milestonesCompletedInPeriod === 1 ? '' : 's'} reached`}
          />
        </StatGrid>
      </AnalyticsSection>

      {goals.atRisk.length > 0 ? (
        <AnalyticsSection title="Behind pace" question="Goals more than 15% below their linear expectation for today.">
          <Card className="space-y-3">
            {goals.atRisk.map((r) => (
              <div key={r.goalId} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <Link to={`/goals/${r.goalId}`} className="min-w-0 truncate text-sm text-ink hover:underline underline-offset-4">
                    {r.title}
                  </Link>
                  <span className="t-num shrink-0 text-xs text-ink-muted">
                    {pct(r.progress)} of an expected {pct(r.expectedProgress ?? 0)}
                  </span>
                </div>
                <ProgressBar className="mt-1.5" value={r.progress} size="sm" color="rose" />
                <div className="t-meta mt-1">
                  {r.daysRemaining !== null && r.daysRemaining >= 0
                    ? `${r.daysRemaining} day${r.daysRemaining === 1 ? '' : 's'} left until ${r.targetDate}.`
                    : `Target date ${r.targetDate} has passed.`}
                </div>
              </div>
            ))}
          </Card>
        </AnalyticsSection>
      ) : null}

      <AnalyticsSection title="Every goal" question="Progress, pace and effort recorded in this window.">
        <Card>
          <DataTable rows={goals.rows} columns={columns} rowKey={(r) => r.goalId} />
        </Card>
      </AnalyticsSection>

      {stalled.length > 0 ? (
        <AnalyticsSection title="Stalled" question="Active goals with no recorded time or completed task in this window.">
          <Card padded={false} className="overflow-hidden">
            {stalled.map((r) => (
              <Link
                key={r.goalId}
                to={`/goals/${r.goalId}`}
                className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-surface-sunken"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.title}</span>
                <span className="t-meta shrink-0">{r.trackerLabel}</span>
                <Badge tone="neutral">{pct(r.progress)}</Badge>
              </Link>
            ))}
          </Card>
          <InsightNote className="mt-3">
            {stalled.length} of {active.length} active goals recorded nothing in this window. Scheduling one block
            against each is the smallest thing that moves them.
          </InsightNote>
        </AnalyticsSection>
      ) : null}
    </>
  );
}
