import { Card } from '@/components/ui/Card';
import { BarChart, MeterRow } from '@/components/charts/Charts';
import { PlanActualRow, StackedShareBar } from '@/components/charts/Comparison';
import { formatDateKeyShort, formatMinute } from '@/lib/date';
import type { TimeMetrics } from '@/engines/analytics';
import type { TrackerPlanActualRow } from '@/services/analyticsService';
import {
  AnalyticsSection, InsightNote, NoData, StatCard, StatGrid, mins, pct,
} from '../components/AnalyticsPrimitives';

/**
 * Time answers: where did the hours go, and did reality match the plan?
 * The planned-vs-actual block is the layout SPEC asks for: one row per tracker,
 * planned bar above the actual bar, with the difference stated in words.
 */
export function TimeSection({
  time, planVsActual,
}: {
  time: TimeMetrics;
  planVsActual: TrackerPlanActualRow[];
}) {
  const hasTime = time.totalMinutes > 0;
  const maxPair = Math.max(1, ...planVsActual.map((r) => Math.max(r.plannedMinutes, r.actualMinutes)));

  return (
    <>
      <AnalyticsSection title="Time recorded" question="How much time was tracked, and on which days?">
        {!hasTime ? (
          <NoData
            title="No time recorded in this window"
            action="Time appears here once you complete a scheduled block, finish a timer session, or tick off a task with recorded minutes."
          />
        ) : (
          <>
            <StatGrid>
              <StatCard label="Total" value={mins(time.totalMinutes)} sub={`${mins(time.dailyAverageMinutes)} per day`} />
              <StatCard
                label="Busiest day"
                value={time.busiestDay ? mins(time.busiestDay.minutes) : '—'}
                sub={time.busiestDay ? formatDateKeyShort(time.busiestDay.date) : 'No active day yet'}
              />
              <StatCard
                label="Quietest active day"
                value={time.quietestActiveDay ? mins(time.quietestActiveDay.minutes) : '—'}
                sub={time.quietestActiveDay ? formatDateKeyShort(time.quietestActiveDay.date) : 'No active day yet'}
              />
              <StatCard
                label="Peak hour"
                value={time.peakHour === null ? '—' : formatMinute(time.peakHour * 60)}
                sub={time.peakHour === null ? 'No timed activity yet' : 'When sessions most often start'}
              />
            </StatGrid>

            <Card className="mt-4">
              <div className="t-section">Daily minutes</div>
              <div className="t-meta mb-3 mt-0.5">Recorded time per day, planned time behind each bar.</div>
              <BarChart
                height={140}
                formatValue={mins}
                labelEvery={time.daily.length > 14 ? Math.ceil(time.daily.length / 8) : 1}
                data={time.daily.map((d) => ({
                  label: formatDateKeyShort(d.date).replace(/^\w+,?\s*/, ''),
                  value: d.minutes,
                  reference: d.plannedMinutes || undefined,
                  formatted: `${formatDateKeyShort(d.date)} · ${mins(d.minutes)} of ${mins(d.plannedMinutes)} planned`,
                }))}
              />
            </Card>
          </>
        )}
      </AnalyticsSection>

      {hasTime ? (
        <>
          <AnalyticsSection title="Distribution" question="Which trackers absorbed the time — including school, sleep and free time?">
            <Card className="space-y-5">
              <div>
                <div className="t-label mb-2">By pillar</div>
                <StackedShareBar
                  formatValue={mins}
                  segments={time.distribution.byPillar.map((p) => ({ id: p.id, label: p.label, value: p.minutes, color: p.color }))}
                />
              </div>
              <div className="border-t border-line pt-4">
                <div className="t-label mb-2">By tracker</div>
                <StackedShareBar
                  formatValue={mins}
                  segments={time.distribution.byTracker.map((t) => ({ id: t.id, label: t.label, value: t.minutes, color: t.color }))}
                />
              </div>
            </Card>
          </AnalyticsSection>

          <AnalyticsSection title="When the work happens" question="Which hours and weekdays carry the load?">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <div className="t-section">By hour of day</div>
                <div className="t-meta mb-3 mt-0.5">Each session is attributed to the hour it started in.</div>
                <BarChart
                  height={120}
                  labelEvery={4}
                  formatValue={mins}
                  data={time.byHour.map((h) => ({
                    label: String(h.hour).padStart(2, '0'),
                    value: h.minutes,
                    formatted: `${formatMinute(h.hour * 60)} · ${mins(h.minutes)} (${pct(h.share)})`,
                  }))}
                />
              </Card>
              <Card className="space-y-3">
                <div>
                  <div className="t-section">By weekday</div>
                  <div className="t-meta mt-0.5">Total minutes, with the mean across active days.</div>
                </div>
                {time.byWeekday.map((d) => (
                  <MeterRow
                    key={d.dayOfWeek}
                    label={d.label}
                    value={d.minutes}
                    max={Math.max(...time.byWeekday.map((x) => x.minutes), 1)}
                    valueLabel={mins(d.minutes)}
                    sub={d.activeDays > 0 ? `${d.activeDays} active · ${mins(d.meanMinutes)} average` : 'No activity on this weekday'}
                  />
                ))}
              </Card>
            </div>
          </AnalyticsSection>
        </>
      ) : null}

      <AnalyticsSection title="Planned versus actual" question={time.plannedVsActual.summary}>
        {planVsActual.length === 0 ? (
          <NoData
            title="Nothing to compare"
            action="Schedule blocks for a tracker and then record time against it — the two are compared side by side here."
          />
        ) : (
          <Card>
            <StatGrid cols={4}>
              <StatCard label="Planned" value={mins(time.plannedVsActual.plannedMinutes)} sub={`${time.plannedVsActual.plannedBlocks} blocks`} />
              <StatCard label="Actual" value={mins(time.plannedVsActual.actualMinutes)} sub={`${pct(time.plannedVsActual.adherence)} of plan`} />
              <StatCard
                label="Blocks completed"
                value={`${time.plannedVsActual.completedBlocks}/${time.plannedVsActual.plannedBlocks}`}
                sub={`${time.plannedVsActual.skippedBlocks} skipped · ${time.plannedVsActual.partialBlocks} partial`}
              />
              <StatCard label="Perfect days" value={time.plannedVsActual.perfectDays} sub="Every planned block completed" />
            </StatGrid>

            <div className="mt-5 divide-y divide-line border-t border-line pt-1">
              {planVsActual.map((row) => (
                <PlanActualRow
                  key={row.trackerId}
                  label={row.label}
                  planned={row.plannedMinutes}
                  actual={row.actualMinutes}
                  max={maxPair}
                  color={row.color}
                  formatValue={mins}
                />
              ))}
            </div>
          </Card>
        )}
      </AnalyticsSection>

      {time.weekly.length > 1 ? (
        <AnalyticsSection title="Week over week" question="How the tracked total moved across the weeks in this window.">
          <Card>
            <BarChart
              height={120}
              formatValue={mins}
              data={time.weekly.map((w) => ({
                label: w.weekKey.slice(-3),
                value: w.minutes,
                formatted: `${w.weekKey} · ${mins(w.minutes)} · ${w.tasksCompleted} tasks`,
              }))}
            />
            <InsightNote className="mt-4">
              {time.weekly.length} weeks in view. The most recent week recorded {mins(time.weekly[time.weekly.length - 1].minutes)}.
            </InsightNote>
          </Card>
        </AnalyticsSection>
      ) : null}
    </>
  );
}
