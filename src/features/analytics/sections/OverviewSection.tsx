import { CalendarRange, Flame } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ProgressBar, Ring } from '@/components/ui/Progress';
import { BarChart, MeterRow } from '@/components/charts/Charts';
import { StackedShareBar, TrendPill } from '@/components/charts/Comparison';
import { formatDateKeyShort } from '@/lib/date';
import type { OverviewMetrics, GoalMetrics } from '@/engines/analytics';
import type { UserProfile } from '@/types';
import {
  AnalyticsSection, InsightNote, NoData, StatCard, StatGrid, mins, pct,
} from '../components/AnalyticsPrimitives';

/**
 * Overview answers one question: how am I doing overall in this window?
 * Completion, consistency, tracked time, level, and the top-line goal picture.
 */
export function OverviewSection({
  overview, goals, profile,
}: {
  overview: OverviewMetrics;
  goals: GoalMetrics;
  profile: UserProfile | undefined;
}) {
  const { completion, streak, distribution, plannedVsActual } = overview;
  const nothingRecorded = overview.totalMinutes === 0 && completion.completed === 0;

  return (
    <>
      <AnalyticsSection title="How the period went" question={overview.headline}>
        <StatGrid>
          <StatCard
            label="Completion rate"
            value={completion.completed + completion.cancelled + completion.skipped === 0 ? '—' : pct(completion.completionRate)}
            sub={
              completion.completed + completion.cancelled + completion.skipped === 0
                ? 'No task reached a decision yet'
                : `${completion.completed} completed · ${completion.skipped} skipped · ${completion.cancelled} cancelled`
            }
          />
          <StatCard
            label="Tracked time"
            value={mins(overview.totalMinutes)}
            sub={`${mins(overview.dailyAverageMinutes)} per day average`}
          />
          <StatCard
            label="Active days"
            value={`${streak.activeDays}/${overview.dayCount}`}
            sub={
              streak.lastActiveDate
                ? `${pct(streak.consistency)} of days since your first record`
                : 'No day in this window has a record yet'
            }
          />
          <StatCard
            label="Current streak"
            value={streak.currentStreak}
            sub={`Longest ${streak.longestStreak} day${streak.longestStreak === 1 ? '' : 's'}`}
          />
        </StatGrid>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="t-label">vs previous {overview.dayCount} days:</span>
          <TrendPill trend={overview.minutesTrend} unit=" min" />
          <TrendPill trend={overview.tasksTrend} unit=" tasks" />
        </div>
      </AnalyticsSection>

      <div className="mb-8 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="t-section">Daily activity</div>
              <div className="t-meta mt-0.5">Recorded minutes, with the planned amount behind each bar.</div>
            </div>
          </div>
          {nothingRecorded ? (
            <NoData
              icon={<CalendarRange className="h-7 w-7" />}
              title="Nothing recorded in this window"
              action="Complete a schedule block, run a focus timer, or tick off a task — each writes an activity record that shows up here."
            />
          ) : (
            <BarChart
              height={140}
              labelEvery={overview.daily.length > 14 ? Math.ceil(overview.daily.length / 8) : 1}
              data={overview.daily.map((d) => ({
                label: formatDateKeyShort(d.date).replace(/^\w+,?\s*/, ''),
                value: d.minutes,
                reference: d.plannedMinutes || undefined,
                formatted: `${formatDateKeyShort(d.date)} · ${mins(d.minutes)} of ${mins(d.plannedMinutes)} planned`,
              }))}
            />
          )}
        </Card>

        <Card className="flex flex-col justify-center gap-4">
          <div className="flex items-center gap-4">
            <Ring value={profile ? (profile.totalXP % 1000) / 1000 : 0} size={72} stroke={7}>
              <span className="t-num text-sm font-semibold text-ink">{profile?.level ?? 1}</span>
            </Ring>
            <div className="min-w-0">
              <div className="t-label">Level</div>
              <div className="t-num mt-1 text-sm text-ink">{profile?.totalXP ?? 0} XP total</div>
              <div className="t-meta mt-0.5 inline-flex items-center gap-1">
                <Flame className="h-3 w-3" />
                {profile?.currentStreak ?? 0} day streak
              </div>
            </div>
          </div>
          <div className="border-t border-line pt-3">
            <div className="t-label">Plan adherence</div>
            <div className="t-num mt-1 text-sm text-ink">
              {plannedVsActual.plannedBlocks === 0 ? '—' : pct(plannedVsActual.adherence)}
            </div>
            <div className="t-meta mt-1">{plannedVsActual.summary}</div>
          </div>
        </Card>
      </div>

      <AnalyticsSection title="Where the time went" question="Which pillars absorbed this period's hours?">
        {distribution.byPillar.length === 0 ? (
          <NoData
            title="No time attributed to a pillar yet"
            action="Time is attributed when an activity carries a tracker — start a timer on a task or complete a scheduled block."
          />
        ) : (
          <Card>
            <StackedShareBar
              formatValue={mins}
              segments={distribution.byPillar.map((p) => ({
                id: p.id,
                label: p.label,
                value: p.minutes,
                color: p.color,
              }))}
            />
            {overview.weakestPillar ? (
              <InsightNote className="mt-4">
                {overview.weakestPillar.label} is at {pct(overview.weakestPillar.attainment)} of its weekly
                target ({mins(overview.weakestPillar.minutes)} recorded against {mins(overview.weakestPillar.targetMinutes)} per week).
              </InsightNote>
            ) : null}
          </Card>
        )}
      </AnalyticsSection>

      <AnalyticsSection
        title="Goals at a glance"
        question={`${goals.active} active · ${goals.completedInPeriod} completed in this period · ${goals.milestonesCompletedInPeriod} milestones reached.`}
      >
        {goals.rows.filter((r) => r.status === 'active').length === 0 ? (
          <NoData
            title="No active goals"
            action="Create a goal to give tasks direction — progress then rolls up here automatically."
          />
        ) : (
          <Card className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="t-label">Weighted progress across active goals</span>
              <span className="t-num text-xs text-ink-muted">{pct(goals.weightedProgress)}</span>
            </div>
            <ProgressBar value={goals.weightedProgress} size="sm" />
            <div className="space-y-3 border-t border-line pt-3">
              {goals.rows
                .filter((r) => r.status === 'active')
                .slice(0, 5)
                .map((row) => (
                  <MeterRow
                    key={row.goalId}
                    label={row.title}
                    value={row.progress}
                    max={1}
                    valueLabel={pct(row.progress)}
                    sub={
                      row.expectedProgress === null
                        ? `${row.trackerLabel} · no target date`
                        : `${row.trackerLabel} · expected ${pct(row.expectedProgress)} by today`
                    }
                  />
                ))}
            </div>
          </Card>
        )}
      </AnalyticsSection>
    </>
  );
}
