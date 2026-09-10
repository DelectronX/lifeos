import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarRange } from 'lucide-react';
import { Page, PageSection } from '@/components/layout/Page';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/Progress';
import { useLiveSettings } from '@/state/useLiveData';
import { useWeeklyReview } from '@/services/analyticsService';
import {
  addDaysToKey, formatDateKeyShort, formatDuration, isoWeekKey, startOfWeekKey, todayKey,
} from '@/lib/date';
import { DaySeries, MetricTile, MinutesBars, NoDataNotice, PeriodNav, TrendPill, VerdictCard } from './ReviewParts';
import type { WeeklyReviewMetrics } from '@/engines/analytics';

/**
 * Weekly Review.
 *
 * Every statement on this page is a number the AnalyticsEngine computed from
 * stored records, printed next to the conclusion it supports. There is no
 * encouragement, no interpretation and no metric that cannot be traced back to
 * a Task, Activity, ScheduleBlock, QuestionAttempt or RevisionEntry.
 */
export function WeeklyReviewPage() {
  const today = todayKey();
  const settings = useLiveSettings();
  const weekStartsOn = settings?.weekStartsOn ?? 1;

  const thisWeekStart = startOfWeekKey(today, weekStartsOn);
  const [from, setFrom] = useState(thisWeekStart);
  const to = addDaysToKey(from, 6);

  const metrics = useWeeklyReview(from, to);

  const hasAnything = useMemo(
    () => Boolean(metrics) && (
      metrics!.totalMinutes > 0
      || metrics!.tasksCompleted > 0
      || metrics!.questionsCompleted > 0
      || metrics!.revisionsDue > 0
      || metrics!.plannedVsActual.plannedBlocks > 0
    ),
    [metrics],
  );

  const nav = (
    <PeriodNav
      label={`${formatDateKeyShort(from)} – ${formatDateKeyShort(to)}`}
      sub={isoWeekKey(from)}
      onPrev={() => setFrom((f) => addDaysToKey(f, -7))}
      onNext={() => setFrom((f) => addDaysToKey(f, 7))}
      onToday={from === thisWeekStart ? undefined : () => setFrom(thisWeekStart)}
      nextDisabled={from >= thisWeekStart}
      todayLabel="This week"
    />
  );

  return (
    <Page
      title="Weekly review"
      subtitle="Only measured numbers. Each conclusion is printed next to the data it came from."
      actions={nav}
    >
      {metrics === undefined ? (
        <Card>
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
            Reading this week&apos;s records…
          </div>
        </Card>
      ) : !hasAnything ? (
        <NoDataNotice
          title="Nothing was recorded this week"
          description="No tracked time, no completed tasks, no scheduled blocks and no study activity fall inside this week. There is nothing measurable to review."
          action={
            from !== thisWeekStart
              ? <Button onClick={() => setFrom(thisWeekStart)}>Go to this week</Button>
              : <Button iconRight={<ArrowRight className="h-3.5 w-3.5" />}><Link to="/schedule">Plan the week</Link></Button>
          }
        />
      ) : (
        <WeeklyBody metrics={metrics} />
      )}
    </Page>
  );
}

function WeeklyBody({ metrics }: { metrics: WeeklyReviewMetrics }) {
  const pva = metrics.plannedVsActual;
  const accuracyMeasured = metrics.questionsCompleted > 0;

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Tasks completed"
          value={metrics.tasksCompleted}
          evidence={<TrendPill trend={metrics.tasksTrend} />}
        />
        <MetricTile
          label="Time tracked"
          value={formatDuration(metrics.totalMinutes)}
          evidence={`across ${metrics.activeDays} active day${metrics.activeDays === 1 ? '' : 's'} of 7`}
        />
        <MetricTile
          label="Questions completed"
          value={metrics.questionsCompleted}
          evidence={
            accuracyMeasured
              ? `${Math.round(metrics.accuracy * 100)}% correct this week`
              : 'No paper or question attempts recorded'
          }
        />
        <MetricTile
          label="Revisions completed"
          value={metrics.revisionsDue > 0 ? `${metrics.revisionsCompleted}/${metrics.revisionsDue}` : '—'}
          evidence={
            metrics.revisionsDue === 0
              ? 'No revisions were due this week'
              : `${Math.round(metrics.revisionCompletionRate * 100)}% of what was due`
          }
        />
      </div>

      <PageSection title="Time by pillar" description="Minutes recorded in the Activity log, not minutes planned.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <PillarStat label="Study" minutes={metrics.studyMinutes} total={metrics.totalMinutes} />
              <PillarStat label="Fitness" minutes={metrics.fitnessMinutes} total={metrics.totalMinutes} />
              <PillarStat label="Skills" minutes={metrics.skillsMinutes} total={metrics.totalMinutes} />
              <PillarStat label="Personal" minutes={metrics.personalMinutes} total={metrics.totalMinutes} />
            </div>
          </Card>
          <Card>
            <MinutesBars
              rows={metrics.distribution.byTracker}
              emptyLabel="No tracked time was attributed to any tracker this week."
            />
          </Card>
        </div>
      </PageSection>

      <PageSection title="Day by day" description="Tracked minutes per day. Days with no records are shown as inactive.">
        <Card>
          <DaySeries days={metrics.daily} />
        </Card>
      </PageSection>

      <PageSection
        title="Planned vs actual"
        description="Schedule blocks you created against what you actually completed."
      >
        {pva.plannedBlocks === 0 ? (
          <Card><p className="t-muted">No schedule blocks were created for this week, so there is no plan to compare against.</p></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="Planned time"
              value={formatDuration(pva.plannedMinutes)}
              evidence={`${pva.plannedBlocks} block${pva.plannedBlocks === 1 ? '' : 's'} scheduled`}
            />
            <MetricTile
              label="Actual time"
              value={formatDuration(pva.actualMinutes)}
              evidence={`${Math.round(pva.adherence * 100)}% of the planned minutes`}
            />
            <MetricTile
              label="Blocks completed"
              value={`${pva.completedBlocks}/${pva.plannedBlocks}`}
              evidence={`${pva.skippedBlocks} skipped · ${pva.partialBlocks} partial`}
            />
            <MetricTile
              label="Perfect days"
              value={pva.perfectDays}
              evidence="days where every planned block was completed"
            />
          </div>
        )}
      </PageSection>

      <PageSection title="Study accuracy" description="Question attempts stored this week against the previous week.">
        {!accuracyMeasured ? (
          <Card>
            <p className="t-muted">
              No questions were attempted this week, so accuracy cannot be measured or compared.
            </p>
          </Card>
        ) : (
          <Card>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="t-num text-2xl font-semibold text-ink">{Math.round(metrics.accuracy * 100)}%</span>
              <TrendPill trend={metrics.accuracyChange} unit="pp" previousUnit="%" decimals={1} />
            </div>
            <p className="t-meta mt-2">
              {metrics.questionsCompleted} question{metrics.questionsCompleted === 1 ? '' : 's'} attempted this week.
              Previous week: {Math.round(metrics.accuracyPrevious * 100)}%.
              {metrics.accuracyPrevious === 0
                ? ' No attempts were recorded in the previous week, so the change is measured against zero.'
                : ''}
            </p>
          </Card>
        )}
      </PageSection>

      <PageSection title="Goal progress" description="Time and completed tasks attributed to a goal this week.">
        {metrics.goalsProgressed.length === 0 ? (
          <Card><p className="t-muted">No tracked time or completed task was attributed to a goal this week.</p></Card>
        ) : (
          <Card className="space-y-3">
            {metrics.goalsProgressed.map((g) => (
              <div key={g.goalId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-ink">{g.title}</span>
                <span className="t-num text-2xs text-ink-muted">
                  {formatDuration(g.minutes)} · {g.tasksCompleted} task{g.tasksCompleted === 1 ? '' : 's'} completed
                </span>
              </div>
            ))}
          </Card>
        )}
      </PageSection>

      <PageSection
        title="Where you stood"
        description="Derived only from recorded minutes and your own configured weekly targets."
      >
        {!metrics.strongest && !metrics.needsAttention ? (
          <Card>
            <p className="t-muted">
              Not enough recorded time this week to name a strongest or weakest area.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {metrics.strongest ? (
              <VerdictCard
                heading="Most time recorded"
                label={metrics.strongest.label}
                evidence={metrics.strongest.evidence}
                tone="positive"
              />
            ) : null}
            {metrics.needsAttention ? (
              <VerdictCard
                heading="Furthest below target"
                label={metrics.needsAttention.label}
                evidence={metrics.needsAttention.evidence}
                tone="caution"
              />
            ) : null}
          </div>
        )}
      </PageSection>

      <div className="flex flex-wrap gap-2">
        <Button iconLeft={<CalendarRange className="h-3.5 w-3.5" />}>
          <Link to="/analytics">Open full analytics</Link>
        </Button>
        <Button iconLeft={<ArrowRight className="h-3.5 w-3.5" />}>
          <Link to="/review/daily">Daily review</Link>
        </Button>
      </div>
    </>
  );
}

function PillarStat({ label, minutes, total }: { label: string; minutes: number; total: number }) {
  const share = total > 0 ? minutes / total : 0;
  return (
    <div className="min-w-0">
      <div className="t-label">{label}</div>
      <div className="t-num mt-1 text-lg font-semibold text-ink">{formatDuration(minutes)}</div>
      <ProgressBar className="mt-1.5" value={share} size="xs" />
      <div className="t-meta mt-1">
        {minutes === 0 ? 'nothing recorded' : `${Math.round(share * 100)}% of tracked time`}
      </div>
    </div>
  );
}
