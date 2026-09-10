import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { Page } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { ProgressBar, Stat } from '@/components/ui/Progress';
import { MistakePicker } from './MistakePicker';
import { STATUS_LABELS, STATUS_SWATCH } from './QuestionPalette';
import {
  analysePaper, MISTAKE_LABELS, QUESTION_SORT_LABELS, sortQuestions,
  type QuestionAnalytics, type QuestionSortKey,
} from '@/engines/paperAnalytics';
import { markReviewed, refreshPaperScore, setMistakeType } from '@/services/paperService';
import { toast } from '@/state/toastStore';
import { formatClock, formatDuration, relativeDayLabel } from '@/lib/date';
import { cn } from '@/lib/cn';
import type { ID } from '@/types';

/**
 * Paper review. Every number on this page comes from `analysePaper` over the
 * stored Question/QuestionAttempt rows — nothing is cached or hardcoded, so
 * editing a mistake classification updates the aggregation immediately.
 */
export function PaperReviewPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const [sort, setSort] = useState<QuestionSortKey>('index');
  const [expanded, setExpanded] = useState<ID | null>(null);

  const bundle = useLiveQuery(async () => {
    if (!paperId) return null;
    const [paper, questions, attempts] = await Promise.all([
      db.papers.get(paperId),
      db.questions.where('paperId').equals(paperId).sortBy('index'),
      db.attempts.where('paperId').equals(paperId).toArray(),
    ]);
    return { paper, questions, attempts };
  }, [paperId]);

  const analytics = useMemo(() => {
    if (!bundle?.paper) return null;
    return analysePaper({
      paper: bundle.paper, questions: bundle.questions, attempts: bundle.attempts, now: new Date(),
    });
  }, [bundle]);

  if (bundle === undefined) {
    return <Page title="Paper review"><Card><div className="t-muted">Loading…</div></Card></Page>;
  }

  if (!analytics || !bundle?.paper) {
    return (
      <Page title="Paper review">
        <EmptyState
          title="Paper not found"
          description="It may have been deleted."
          action={<Link to="/focus"><Button variant="primary">Back to Focus</Button></Link>}
        />
      </Page>
    );
  }

  const paper = bundle.paper;
  const t = analytics.totals;
  const rows = sortQuestions(analytics.questions, sort);

  const onClassify = async (questionId: ID, type: Parameters<typeof setMistakeType>[1]) => {
    await setMistakeType(questionId, type);
    await refreshPaperScore(paper.id);
  };

  return (
    <Page
      title={paper.title}
      wide
      subtitle={`${relativeDayLabel(paper.date)} · ${t.questions} questions · ${formatDuration(paper.durationMinutes)} allotted`}
      actions={
        <div className="flex items-center gap-2">
          <Link to="/focus"><Button variant="ghost">Back</Button></Link>
          {paper.status !== 'reviewed' ? (
            <Button
              variant="primary"
              onClick={() => void markReviewed(paper.id).then(() => toast.success('Marked as reviewed'))}
            >
              Mark reviewed
            </Button>
          ) : (
            <Badge tone="positive">Reviewed</Badge>
          )}
        </div>
      }
    >
      {/* Summary */}
      <Card className="mb-5">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Score" value={`${round(t.score)} / ${t.maxScore}`} sub={`${Math.round(t.scorePct * 100)}%`} />
          <Stat
            label="Accuracy"
            value={`${Math.round(t.accuracy * 100)}%`}
            sub={`${t.correct} of ${t.attempted} attempted`}
            tone={t.accuracy >= 0.75 ? 'positive' : t.accuracy < 0.4 && t.attempted > 0 ? 'critical' : 'default'}
          />
          <Stat label="Attempted" value={`${t.attempted}/${t.questions}`} sub={`${t.skipped} skipped · ${t.untouched} untouched`} />
          <Stat label="Total time" value={formatDuration(t.totalTimeMs / 60_000)} sub={t.elapsedMs !== null ? `${formatDuration(t.elapsedMs / 60_000)} on the clock` : undefined} />
          <Stat label="Avg / question" value={formatClock(t.time.averageMs)} sub={`median ${formatClock(t.time.medianMs)}`} />
          <Stat label="Fastest / slowest" value={formatClock(t.time.fastestMs)} sub={`slowest ${formatClock(t.time.slowestMs)}`} />
        </div>

        <div className="mt-5 space-y-2">
          <StatusBar
            label="Outcome"
            segments={[
              { value: t.correct, className: 'bg-positive', label: 'Correct' },
              { value: t.incorrect, className: 'bg-critical', label: 'Incorrect' },
              { value: t.skipped, className: 'bg-caution', label: 'Skipped' },
              { value: t.marked, className: 'bg-accent', label: 'Marked' },
              { value: t.untouched, className: 'bg-line-strong', label: 'Untouched' },
            ]}
            total={t.questions}
          />
          <div className="t-meta">
            Correct answers averaged {formatClock(t.averageCorrectMs)}; incorrect ones {formatClock(t.averageIncorrectMs)}.{' '}
            {analytics.pacing.overtimeQuestions} question{analytics.pacing.overtimeQuestions === 1 ? '' : 's'} ran past their
            target pace.
          </div>
        </div>
      </Card>

      {/* Sections */}
      <Card className="mb-5">
        <div className="t-section mb-3">By subject</div>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <Th>Section</Th><Th right>Score</Th><Th right>Attempted</Th>
                <Th right>Correct</Th><Th right>Incorrect</Th><Th right>Skipped</Th>
                <Th right>Accuracy</Th><Th right>Time</Th><Th right>Avg / Q</Th>
              </tr>
            </thead>
            <tbody>
              {analytics.sections.map((s) => (
                <tr key={s.sectionId} className="border-b border-line/60 last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-ink">{s.name}</td>
                  <Td>{round(s.score)} / {s.maxScore}</Td>
                  <Td>{s.attempted}/{s.questions}</Td>
                  <Td>{s.correct}</Td>
                  <Td>{s.incorrect}</Td>
                  <Td>{s.skipped}</Td>
                  <Td>
                    <span className={cn(s.accuracy >= 0.75 ? 'text-positive' : s.accuracy < 0.4 && s.attempted > 0 ? 'text-critical' : '')}>
                      {s.attempted ? `${Math.round(s.accuracy * 100)}%` : '—'}
                    </span>
                  </Td>
                  <Td>{formatDuration(s.totalTimeMs / 60_000)}</Td>
                  <Td>{s.averageMs ? formatClock(s.averageMs) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mistake patterns */}
      <Card className="mb-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div className="t-section">Mistake patterns</div>
          {analytics.unclassifiedMistakes > 0 ? (
            <span className="t-meta">
              {analytics.unclassifiedMistakes} incorrect question{analytics.unclassifiedMistakes === 1 ? '' : 's'} not classified yet
            </span>
          ) : null}
        </div>
        {analytics.mistakes.length === 0 ? (
          <p className="t-muted">
            {t.incorrect === 0
              ? 'No incorrect answers on this paper.'
              : 'Classify the incorrect questions below to see where marks are being lost.'}
          </p>
        ) : (
          <div className="space-y-2.5">
            {analytics.mistakes.map((m) => (
              <div key={m.type}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="text-sm text-ink">{m.label}</span>
                  <span className="t-meta">
                    {m.count} · {Math.round(m.share * 100)}% of classified · {round(m.marksLost)} marks lost ·{' '}
                    avg {formatClock(m.averageTimeMs)}
                  </span>
                </div>
                <ProgressBar value={m.share} color="rose" size="sm" />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Question table */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="t-section">Every question</div>
          <Select
            sizeVariant="sm"
            className="w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value as QuestionSortKey)}
          >
            {(Object.keys(QUESTION_SORT_LABELS) as QuestionSortKey[]).map((k) => (
              <option key={k} value={k}>{QUESTION_SORT_LABELS[k]}</option>
            ))}
          </Select>
        </div>

        <ul className="space-y-1.5">
          {rows.map((r) => (
            <QuestionRow
              key={r.questionId}
              row={r}
              expanded={expanded === r.questionId}
              onToggle={() => setExpanded(expanded === r.questionId ? null : r.questionId)}
              onClassify={(type) => void onClassify(r.questionId, type)}
            />
          ))}
        </ul>
      </Card>
    </Page>
  );
}

function QuestionRow({
  row, expanded, onToggle, onClassify,
}: {
  row: QuestionAnalytics;
  expanded: boolean;
  onToggle: () => void;
  onClassify: (type: Parameters<typeof setMistakeType>[1]) => void;
}) {
  const canClassify = row.status === 'incorrect';
  return (
    <li className="rounded-lg border border-line">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-left"
      >
        <span className={cn('t-num flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-medium', STATUS_SWATCH[row.status])}>
          {row.index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{row.sectionName}</span>
          <span className="t-meta">
            {STATUS_LABELS[row.status]}
            {row.mistakeType ? ` · ${MISTAKE_LABELS[row.mistakeType]}` : ''}
            {row.visits > 1 ? ` · ${row.visits} visits` : ''}
          </span>
        </span>
        <span className="t-num text-xs text-ink-muted">{row.earned >= 0 ? `+${round(row.earned)}` : round(row.earned)}</span>
        <span className={cn('t-num w-16 text-right text-sm tabular-nums', row.overtimeMs > 0 ? 'text-caution' : 'text-ink')}>
          {row.timeSpentMs ? formatClock(row.timeSpentMs) : '—'}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-line px-3 py-3">
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Time spent" value={row.timeSpentMs ? formatClock(row.timeSpentMs) : 'Never opened'} />
            <MiniStat label="Target pace" value={formatClock(row.expectedMs)} />
            <MiniStat
              label="Vs target"
              value={row.timeSpentMs ? `${row.overtimeMs >= 0 ? '+' : '−'}${formatClock(Math.abs(row.overtimeMs))}` : '—'}
            />
            <MiniStat label="Visits" value={String(row.visits)} />
          </div>
          {canClassify ? (
            <>
              <div className="t-label mb-2">Mistake type</div>
              <MistakePicker size="sm" value={row.mistakeType} onChange={onClassify} />
            </>
          ) : (
            <p className="t-meta">Mistake classification applies to incorrect answers only.</p>
          )}
          {row.notes ? <p className="t-meta mt-3">{row.notes}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function StatusBar({
  label, segments, total,
}: {
  label: string;
  segments: { value: number; className: string; label: string }[];
  total: number;
}) {
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div className="t-label mb-1.5">{label}</div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line/60">
        {visible.map((s) => (
          <div
            key={s.label}
            className={s.className}
            style={{ width: `${total > 0 ? (s.value / total) * 100 : 0}%` }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {visible.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', s.className)} />
            <span className="t-meta">{s.label} {s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="t-label">{label}</div>
      <div className="t-num mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cn('pb-2 pr-3 text-xs font-medium text-ink-muted', right && 'text-right')}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="t-num py-2.5 pr-3 text-right text-ink-muted">{children}</td>;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
