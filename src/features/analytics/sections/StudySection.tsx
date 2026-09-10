import { BookOpen } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BarChart, LineChart, MeterRow } from '@/components/charts/Charts';
import { TrendPill } from '@/components/charts/Comparison';
import { DataTable, type Column } from '@/components/charts/DataTable';
import { formatDateKeyShort } from '@/lib/date';
import type {
  PaperSummary, StudyMetrics, SubjectPerformance, TopicPerformance,
} from '@/engines/analytics';
import {
  AnalyticsSection, InsightNote, NoData, StatCard, StatGrid, mins, pct,
} from '../components/AnalyticsPrimitives';

/**
 * Study answers: is the studying working? Time in, questions out, accuracy
 * direction, and which subjects and topics are actually weak.
 */
export function StudySection({ study }: { study: StudyMetrics }) {
  const hasTime = study.studyMinutes > 0 || study.sessionCount > 0;
  const hasQuestions = study.questionsAttempted > 0;

  const subjectColumns: Column<SubjectPerformance>[] = [
    { key: 'label', header: 'Subject', primary: true, cell: (r) => r.label },
    { key: 'minutes', header: 'Time', align: 'right', cell: (r) => <span className="t-num">{mins(r.minutes)}</span> },
    { key: 'attempted', header: 'Questions', align: 'right', cell: (r) => <span className="t-num">{r.questionsAttempted}</span> },
    {
      key: 'accuracy',
      header: 'Accuracy',
      align: 'right',
      cell: (r) => (r.questionsAttempted === 0 ? <span className="t-meta">—</span> : <span className="t-num">{pct(r.accuracy)}</span>),
    },
    {
      key: 'pace',
      header: 'Per question',
      align: 'right',
      cell: (r) => (r.meanSecondsPerQuestion === 0 ? <span className="t-meta">—</span> : <span className="t-num">{r.meanSecondsPerQuestion}s</span>),
    },
  ];

  const topicColumns: Column<TopicPerformance>[] = [
    { key: 'topic', header: 'Topic', primary: true, cell: (r) => r.topic },
    { key: 'attempted', header: 'Attempted', align: 'right', cell: (r) => <span className="t-num">{r.attempted}</span> },
    { key: 'correct', header: 'Correct', align: 'right', cell: (r) => <span className="t-num">{r.correct}</span> },
    {
      key: 'accuracy',
      header: 'Accuracy',
      align: 'right',
      cell: (r) => (
        <Badge tone={r.accuracy >= 0.8 ? 'positive' : r.accuracy >= 0.5 ? 'caution' : 'critical'}>
          {pct(r.accuracy)}
        </Badge>
      ),
    },
  ];

  const paperColumns: Column<PaperSummary>[] = [
    { key: 'title', header: 'Paper', primary: true, cell: (r) => r.title },
    { key: 'date', header: 'Date', cell: (r) => <span className="t-num">{formatDateKeyShort(r.date)}</span> },
    {
      key: 'score',
      header: 'Score',
      align: 'right',
      cell: (r) => (r.maxScore > 0 ? <span className="t-num">{r.score}/{r.maxScore} ({r.scorePercent}%)</span> : <span className="t-meta">—</span>),
    },
    {
      key: 'accuracy',
      header: 'Accuracy',
      align: 'right',
      cell: (r) => (r.attempted === 0 ? <span className="t-meta">—</span> : <span className="t-num">{pct(r.accuracy)}</span>),
    },
  ];

  return (
    <>
      <AnalyticsSection title="Study effort" question="How much time went in, and how was it spent?">
        {!hasTime ? (
          <NoData
            icon={<BookOpen className="h-7 w-7" />}
            title="No study time recorded in this window"
            action="Run a focus timer on a study task, or complete a study block on the schedule."
          />
        ) : (
          <StatGrid>
            <StatCard label="Study time" value={mins(study.studyMinutes)} sub={`${study.sessionCount} session${study.sessionCount === 1 ? '' : 's'}`} />
            <StatCard label="Mean session" value={mins(study.meanSessionMinutes)} sub={`Longest ${mins(study.longestSessionMinutes)}`} />
            <StatCard label="Pomodoros" value={study.pomodoros} sub="Completed work intervals" />
            <StatCard label="Papers" value={study.papersSubmitted} sub="Submitted or reviewed" />
          </StatGrid>
        )}
      </AnalyticsSection>

      <AnalyticsSection title="Question accuracy" question="Are answers getting more reliable?">
        {!hasQuestions ? (
          <NoData
            title="No questions attempted yet"
            action="Run a paper in Paper Mode or use Question Mode — each attempt records its result and time."
          />
        ) : (
          <>
            <StatGrid>
              <StatCard label="Attempted" value={study.questionsAttempted} sub={`${study.questionsCorrect} correct`} />
              <StatCard label="Accuracy" value={pct(study.accuracy)} sub={`${study.questionsAttempted - study.questionsCorrect} incorrect`} />
              <StatCard label="Per question" value={`${study.meanSecondsPerQuestion}s`} sub="Mean time on attempted questions" />
              <StatCard
                label="Accuracy trend"
                value={study.papers.length < 2 ? '—' : `${study.accuracyTrend.current}%`}
                sub={study.papers.length < 2 ? 'Needs two papers to compare' : `Earlier papers averaged ${study.accuracyTrend.previous}%`}
              />
            </StatGrid>

            {study.papers.length >= 2 ? (
              <Card className="mt-4">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="t-section">Accuracy per paper</div>
                    <div className="t-meta mt-0.5">In date order, oldest first.</div>
                  </div>
                  <TrendPill trend={study.accuracyTrend} unit="pp" />
                </div>
                <LineChart
                  height={140}
                  formatValue={(v) => `${Math.round(v)}%`}
                  data={study.papers.map((p) => ({
                    label: formatDateKeyShort(p.date),
                    value: Math.round(p.accuracy * 100),
                  }))}
                />
              </Card>
            ) : null}
          </>
        )}
      </AnalyticsSection>

      {study.mistakes.length > 0 ? (
        <AnalyticsSection title="Why answers were wrong" question="Mistake classification across incorrect attempts.">
          <Card className="space-y-3">
            {study.mistakes.map((m) => (
              <MeterRow
                key={m.type}
                label={m.label}
                value={m.count}
                max={study.mistakes[0].count}
                valueLabel={`${m.count} · ${pct(m.share)}`}
                color="rose"
              />
            ))}
            <InsightNote>
              {study.mistakes[0].label.toLowerCase()} accounts for {pct(study.mistakes[0].share)} of incorrect
              answers ({study.mistakes[0].count} of {study.mistakes.reduce((s, m) => s + m.count, 0)}).
            </InsightNote>
          </Card>
        </AnalyticsSection>
      ) : null}

      <AnalyticsSection title="By subject" question="Where is the effort going, and where is it paying off?">
        <Card>
          <DataTable
            rows={study.bySubject}
            columns={subjectColumns}
            rowKey={(r) => r.trackerId}
            empty={
              <NoData
                title="No subject-level data yet"
                action="Attach study time or paper questions to a subject tracker to break performance down here."
              />
            }
          />
        </Card>
      </AnalyticsSection>

      <AnalyticsSection title="Weakest topics" question="Which topics have the lowest accuracy? Lowest first.">
        <Card>
          <DataTable
            rows={study.byTopic.slice(0, 12)}
            columns={topicColumns}
            rowKey={(r) => r.topic}
            empty={
              <NoData
                title="No topics recorded"
                action="Give questions a topic when building a paper — accuracy then aggregates per topic here."
              />
            }
          />
        </Card>
      </AnalyticsSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <AnalyticsSection title="Papers" question="Each submitted paper with its score and accuracy.">
          <Card>
            <DataTable
              rows={[...study.papers].reverse()}
              columns={paperColumns}
              rowKey={(r) => r.paperId}
              empty={<NoData title="No papers in this window" action="Build and submit a paper in Paper Mode to see scores here." />}
            />
          </Card>
        </AnalyticsSection>

        <AnalyticsSection title="Revision" question="Is spaced repetition being kept up?">
          {study.revisionsDue === 0 && study.revisionsCompleted === 0 ? (
            <NoData
              title="No revisions scheduled in this window"
              action="Add a revision plan to a topic or paper — due entries and completion rate appear here."
            />
          ) : (
            <Card className="space-y-3">
              <MeterRow
                label="Completed on schedule"
                value={study.revisionsCompleted}
                max={Math.max(study.revisionsDue, study.revisionsCompleted, 1)}
                valueLabel={`${study.revisionsCompleted} of ${study.revisionsDue} due`}
                color="teal"
                sub={`${pct(study.revisionCompletionRate)} completion rate`}
              />
              {study.revisionsMissed > 0 ? (
                <InsightNote>
                  {study.revisionsMissed} revision{study.revisionsMissed === 1 ? ' was' : 's were'} marked missed in
                  this window. The rescheduling engine can place them again from the Revision page.
                </InsightNote>
              ) : null}
            </Card>
          )}
        </AnalyticsSection>
      </div>

      {hasTime && study.bySubject.length > 1 ? (
        <AnalyticsSection title="Time split across subjects" question="Minutes recorded per subject in this window.">
          <Card>
            <BarChart
              height={130}
              formatValue={mins}
              data={study.bySubject
                .filter((s) => s.minutes > 0)
                .map((s) => ({ label: s.label, value: s.minutes, formatted: `${s.label} · ${mins(s.minutes)}` }))}
            />
          </Card>
        </AnalyticsSection>
      ) : null}
    </>
  );
}
