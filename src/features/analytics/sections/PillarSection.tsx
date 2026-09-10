import { Activity as ActivityIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BarChart, HeatStrip, MeterRow } from '@/components/charts/Charts';
import { StackedShareBar } from '@/components/charts/Comparison';
import { formatDateKeyShort } from '@/lib/date';
import type { PillarMetrics } from '@/engines/analytics';
import type { Pillar } from '@/types';
import { PILLAR_COPY } from '../pillarCopy';
import {
  AnalyticsSection, InsightNote, NoData, StatCard, StatGrid, mins, pct,
} from '../components/AnalyticsPrimitives';

/**
 * The universal pillar view.
 *
 * Fitness, Skills and Personal are the *same* analysis — time, sessions,
 * consistency, per-tracker split, habits, goals — over a different subtree of
 * trackers. `computePillarMetrics(input, pillar)` already produced all of it;
 * this component only decides how it reads, using PILLAR_COPY for wording.
 * The Tracker pillar pages render this exact component.
 */
export function PillarSection({
  metrics, pillar, variant = 'full',
}: {
  metrics: PillarMetrics;
  pillar: Exclude<Pillar, 'system'>;
  /**
   * 'full' is the standalone pillar view. 'consistency' renders only the
   * cadence cards — used next to the Study section, whose own headline numbers
   * already cover the same time totals.
   */
  variant?: 'full' | 'consistency';
}) {
  const copy = PILLAR_COPY[pillar];
  const hasData = metrics.totalMinutes > 0 || metrics.activeDays > 0 || metrics.tasksCompleted > 0;

  if (!hasData) {
    if (variant === 'consistency') return null;
    return (
      <AnalyticsSection title={copy.title} question={copy.question}>
        <NoData
          icon={<ActivityIcon className="h-7 w-7" />}
          title={`Nothing recorded for ${copy.title.toLowerCase()} in this window`}
          action={copy.emptyAction}
        />
      </AnalyticsSection>
    );
  }

  const consistencyCards = (
    <div className="mb-8 grid gap-4 lg:grid-cols-2">
      <Card>
        <div className="t-section">Consistency</div>
        <div className="t-meta mb-3 mt-0.5">
          One square per day in the window; darker means more minutes recorded.
        </div>
        <HeatStrip
          data={metrics.daily.map((d) => ({ date: d.date, value: d.minutes }))}
          formatValue={(v, date) => `${formatDateKeyShort(date)}: ${mins(v)}`}
        />
        <div className="t-meta mt-3">
          {metrics.activeDays} active day{metrics.activeDays === 1 ? '' : 's'} · longest streak{' '}
          {metrics.streak.longestStreak} day{metrics.streak.longestStreak === 1 ? '' : 's'}
          {metrics.streak.lastActiveDate ? ` · last active ${formatDateKeyShort(metrics.streak.lastActiveDate)}` : ''}
        </div>
      </Card>

      <Card>
        <div className="t-section">Daily minutes</div>
        <div className="t-meta mb-3 mt-0.5">Time recorded against this pillar on each day of the window.</div>
        <BarChart
          height={130}
          formatValue={mins}
          labelEvery={metrics.daily.length > 14 ? Math.ceil(metrics.daily.length / 8) : 1}
          data={metrics.daily.map((d) => ({
            label: formatDateKeyShort(d.date).replace(/^\w+,?\s*/, ''),
            value: d.minutes,
            formatted: `${formatDateKeyShort(d.date)} · ${mins(d.minutes)}`,
          }))}
        />
      </Card>
    </div>
  );

  if (variant === 'consistency') return consistencyCards;

  return (
    <>
      <AnalyticsSection title={copy.title} question={copy.question}>
        <StatGrid>
          <StatCard label="Total time" value={mins(metrics.totalMinutes)} sub={`${mins(metrics.weeklyAverageMinutes)} per week at this rate`} />
          <StatCard
            label={copy.sessionLabel}
            value={metrics.sessionCount}
            sub={metrics.sessionCount > 0 ? `${mins(metrics.meanSessionMinutes)} average` : 'No timed sessions'}
          />
          <StatCard
            label="Active days"
            value={metrics.activeDays}
            sub={`${pct(metrics.streak.consistency)} of days since first record · streak ${metrics.streak.currentStreak}`}
          />
          <StatCard
            label="Weekly target"
            value={metrics.weeklyTargetMinutes ? pct(metrics.targetAttainment ?? 0) : '—'}
            sub={
              metrics.weeklyTargetMinutes
                ? `${mins(metrics.weeklyAverageMinutes)} of ${mins(metrics.weeklyTargetMinutes)} per week`
                : 'No weekly target set on this tracker'
            }
          />
        </StatGrid>

        {metrics.weeklyTargetMinutes && metrics.targetAttainment !== null ? (
          <InsightNote className="mt-3">
            At the current pace this pillar reaches {pct(metrics.targetAttainment)} of its {mins(metrics.weeklyTargetMinutes)} weekly
            target. Set or change the target on the tracker itself.
          </InsightNote>
        ) : null}
      </AnalyticsSection>

      {consistencyCards}

      <AnalyticsSection title={copy.breakdownTitle} question={copy.breakdownQuestion}>
        {metrics.byTracker.length === 0 ? (
          <NoData
            title="No per-tracker split available"
            action="Create child trackers under this pillar (e.g. one per discipline) so time can be attributed to them."
          />
        ) : (
          <Card>
            <StackedShareBar
              formatValue={mins}
              segments={metrics.byTracker.map((t) => ({ id: t.id, label: t.label, value: t.minutes, color: t.color }))}
            />
          </Card>
        )}
      </AnalyticsSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <AnalyticsSection title="Habits" question={copy.habitsQuestion}>
          {metrics.habits.length === 0 ? (
            <NoData title="No habits in this pillar" action="Create a habit attached to one of this pillar's trackers to track check-ins here." />
          ) : (
            <Card className="space-y-3">
              {metrics.habits.map((h) => (
                <MeterRow
                  key={h.habitId}
                  label={h.title}
                  value={h.checkins}
                  max={Math.max(...metrics.habits.map((x) => x.checkins), 1)}
                  valueLabel={`${h.checkins} check-in${h.checkins === 1 ? '' : 's'}`}
                  sub={`Current streak ${h.currentStreak}`}
                  color="teal"
                />
              ))}
            </Card>
          )}
        </AnalyticsSection>

        <AnalyticsSection title="Goals" question={copy.goalsQuestion}>
          {metrics.goals.length === 0 ? (
            <NoData title="No goals in this pillar" action="Attach a goal to one of this pillar's trackers to see its progress here." />
          ) : (
            <Card padded={false} className="overflow-hidden">
              {metrics.goals.map((g) => (
                <Link
                  key={g.goalId}
                  to={`/goals/${g.goalId}`}
                  className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{g.title}</span>
                  <Badge tone={g.progress >= 1 ? 'positive' : g.progress > 0 ? 'accent' : 'neutral'}>
                    {pct(g.progress)}
                  </Badge>
                </Link>
              ))}
            </Card>
          )}
        </AnalyticsSection>
      </div>
    </>
  );
}
