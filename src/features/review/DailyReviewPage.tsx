import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarCheck } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useDailyReview } from '@/services/analyticsService';
import { addDaysToKey, formatDateKeyLong, relativeDayLabel, todayKey } from '@/lib/date';
import { NoDataNotice, PeriodNav } from './ReviewParts';
import { DailyRecap } from './DailyRecap';
import { DailySummary } from './DailySummary';
import { TaskTriageCard, type TriageOutcome } from './TaskTriageCard';
import type { DateKey, ID, Task } from '@/types';

type Step = 'recap' | 'triage' | 'summary';

/**
 * Daily Review — a guided close-out, not a dashboard.
 *
 * Three steps: look at what the day actually contained, decide what happens to
 * each unfinished task (using the ReschedulingEngine's own options and
 * explanations), then read back a summary of everything that moved.
 */
export function DailyReviewPage() {
  const today = todayKey();
  const [date, setDate] = useState<DateKey>(today);
  const [step, setStep] = useState<Step>('recap');

  const metrics = useDailyReview(date);

  /** Frozen at the moment triage starts so the queue cannot shift under the user. */
  const [queue, setQueue] = useState<Task[]>([]);
  const [cursor, setCursor] = useState(0);
  const [outcomes, setOutcomes] = useState<TriageOutcome[]>([]);
  const [skipped, setSkipped] = useState<ID[]>([]);

  const reset = useCallback(() => {
    setStep('recap');
    setQueue([]);
    setCursor(0);
    setOutcomes([]);
    setSkipped([]);
  }, []);

  // Changing the day starts a fresh review.
  useEffect(() => { reset(); }, [date, reset]);

  const startTriage = () => {
    if (!metrics) return;
    setQueue(metrics.incompleteTasks);
    setCursor(0);
    setOutcomes([]);
    setSkipped([]);
    setStep(metrics.incompleteTasks.length > 0 ? 'triage' : 'summary');
  };

  const advance = useCallback((next: number) => {
    setCursor(next);
    if (next >= queue.length) setStep('summary');
  }, [queue.length]);

  const handleResolved = useCallback((outcome: TriageOutcome) => {
    setOutcomes((prev) => [...prev.filter((o) => o.taskId !== outcome.taskId), outcome]);
    advance(cursor + 1);
  }, [advance, cursor]);

  const handleSkip = useCallback((task: Task) => {
    setSkipped((prev) => (prev.includes(task.id) ? prev : [...prev, task.id]));
    advance(cursor + 1);
  }, [advance, cursor]);

  const hasAnything = useMemo(
    () => Boolean(metrics) && (
      metrics!.completedTasks.length > 0
      || metrics!.incompleteTasks.length > 0
      || metrics!.minutesTracked > 0
      || metrics!.blocksPlanned > 0
      || metrics!.xpEarned > 0
    ),
    [metrics],
  );

  const nav = (
    <div className="flex flex-wrap items-center gap-3">
      <PeriodNav
        label={relativeDayLabel(date, today)}
        sub={formatDateKeyLong(date)}
        onPrev={() => setDate((d) => addDaysToKey(d, -1))}
        onNext={() => setDate((d) => addDaysToKey(d, 1))}
        onToday={date === today ? undefined : () => setDate(today)}
        nextDisabled={date >= today}
      />
      <Button size="sm">
        <Link to="/review/weekly">Weekly review</Link>
      </Button>
    </div>
  );

  return (
    <Page
      title="Daily review"
      subtitle="Close out the day: see what happened, then decide what happens to what did not."
      actions={nav}
    >
      {metrics === undefined ? (
        <Card>
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
            Reading this day&apos;s records…
          </div>
        </Card>
      ) : !hasAnything ? (
        <NoDataNotice
          title={
            date === today
              ? 'Nothing recorded today yet'
              : `Nothing was recorded on ${relativeDayLabel(date, today).toLowerCase()}`
          }
          description="No tasks were due or completed, no blocks were scheduled and no time was tracked on this day. There is nothing to review — this is an empty day, not a bad one."
          action={
            date !== today ? (
              <Button onClick={() => setDate(today)}>Go to today</Button>
            ) : undefined
          }
        />
      ) : step === 'recap' ? (
        <div className="space-y-6">
          <DailyRecap metrics={metrics} date={date} />
          <div className="sticky bottom-16 z-10 lg:bottom-4">
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <p className="t-meta min-w-0">
                {metrics.incompleteTasks.length === 0
                  ? 'Nothing is left open — you can finish the review now.'
                  : `${metrics.incompleteTasks.length} task${metrics.incompleteTasks.length === 1 ? '' : 's'} still open. The rescheduling engine will cost the options for each one.`}
              </p>
              <Button
                variant="primary"
                iconRight={<ArrowRight className="h-3.5 w-3.5" />}
                onClick={startTriage}
              >
                {metrics.incompleteTasks.length === 0 ? 'Finish the day' : 'Review open tasks'}
              </Button>
            </Card>
          </div>
        </div>
      ) : step === 'triage' && queue[cursor] ? (
        <div className="space-y-4">
          <TriageProgress done={cursor} total={queue.length} />
          <TaskTriageCard
            key={queue[cursor]!.id}
            task={queue[cursor]!}
            index={cursor}
            total={queue.length}
            date={date}
            onResolved={handleResolved}
            onSkip={handleSkip}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              iconLeft={<ArrowLeft className="h-3.5 w-3.5" />}
              onClick={() => (cursor === 0 ? setStep('recap') : setCursor(cursor - 1))}
            >
              Back
            </Button>
            <Button
              iconLeft={<CalendarCheck className="h-3.5 w-3.5" />}
              onClick={() => {
                const rest = queue.slice(cursor).map((t) => t.id);
                setSkipped((prev) => [...new Set([...prev, ...rest])]);
                setStep('summary');
              }}
            >
              Finish now, leave the rest open
            </Button>
          </div>
        </div>
      ) : (
        <DailySummary
          metrics={metrics}
          outcomes={outcomes}
          leftOpen={skipped.length}
          onReopen={() => setStep('recap')}
        />
      )}
    </Page>
  );
}

function TriageProgress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`${done} of ${total} reviewed`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full ${i < done ? 'bg-accent' : i === done ? 'bg-accent/40' : 'bg-line'}`}
        />
      ))}
    </div>
  );
}
