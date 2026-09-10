import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Flag, Pause, Play, SkipForward } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { QuestionPalette } from './QuestionPalette';
import { MistakePicker } from './MistakePicker';
import { usePaperRun } from './usePaperRun';
import { setMistakeType, setQuestionStatus } from '@/services/paperService';
import { toast } from '@/state/toastStore';
import { formatClock, formatDuration } from '@/lib/date';
import { cn } from '@/lib/cn';
import type { ID, QuestionStatus } from '@/types';

const ANSWER_ACTIONS: { status: QuestionStatus; label: string; tone: string }[] = [
  { status: 'correct', label: 'Correct', tone: 'border-positive/40 text-positive hover:bg-positive/10' },
  { status: 'incorrect', label: 'Incorrect', tone: 'border-critical/40 text-critical hover:bg-critical/10' },
  { status: 'skipped', label: 'Skipped', tone: 'border-caution/40 text-caution hover:bg-caution/10' },
  { status: 'marked', label: 'Mark for review', tone: 'border-accent/40 text-accent-ink hover:bg-accent-soft' },
];

/**
 * Paper runner: global countdown, per-question timing, status marking and
 * mistake classification. Resilient to refresh — the run state is persisted and
 * all times are wall-clock derived.
 */
export function PaperRunnerPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const run = usePaperRun(paperId);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const sectionNames = useMemo(
    () => Object.fromEntries((run.paper?.sections ?? []).map((s) => [s.id, s.name])) as Record<ID, string>,
    [run.paper],
  );

  const counts = useMemo(() => {
    const list = run.questions.map((q) => run.attempts[q.id]?.status ?? 'unattempted');
    return {
      total: list.length,
      answered: list.filter((s) => s === 'correct' || s === 'incorrect').length,
      skipped: list.filter((s) => s === 'skipped').length,
      marked: list.filter((s) => s === 'marked').length,
      untouched: list.filter((s) => s === 'unattempted').length,
    };
  }, [run.questions, run.attempts]);

  if (run.loading) {
    return <Page title="Paper"><Card><div className="t-muted">Loading…</div></Card></Page>;
  }

  if (!run.paper) {
    return (
      <Page title="Paper">
        <EmptyState
          title="Paper not found"
          description="It may have been deleted."
          action={<Link to="/focus"><Button variant="primary">Back to Focus</Button></Link>}
        />
      </Page>
    );
  }

  const paper = run.paper;
  const done = paper.status === 'submitted' || paper.status === 'reviewed';

  // --- not started / already submitted --------------------------------------
  if (done && !run.run) {
    return (
      <Page title={paper.title} subtitle="This paper has been submitted.">
        <Card>
          <div className="t-section mb-2">{paper.score} / {paper.maxScore} marks</div>
          <p className="t-muted mb-4">Open the review to see per-question timing and mistake patterns.</p>
          <div className="flex gap-2">
            <Link to={`/focus/paper/${paper.id}/review`}><Button variant="primary">Open review</Button></Link>
            <Link to="/focus"><Button variant="ghost">Back to Focus</Button></Link>
          </div>
        </Card>
      </Page>
    );
  }

  if (!run.run) {
    const questions = run.questions.length;
    return (
      <Page title={paper.title} subtitle={`${paper.sections.length} sections · ${questions} questions · ${formatDuration(paper.durationMinutes)}`}>
        <Card className="mx-auto max-w-xl">
          <div className="t-section mb-3">Ready to start</div>
          <ul className="mb-5 space-y-1.5">
            {paper.sections.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                <span className="text-sm text-ink">{s.name}</span>
                <span className="t-meta">
                  {s.questionCount} × {s.marksPerQuestion} marks
                  {s.negativeMarks > 0 ? ` · −${s.negativeMarks}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="t-meta mb-4">
            {paper.timed
              ? `A ${formatDuration(paper.durationMinutes)} countdown starts when you begin. Time per question is recorded automatically as you navigate.`
              : 'Untimed run. Time per question is still recorded as you navigate.'}
          </p>
          <div className="flex gap-2">
            <Button variant="primary" size="lg" onClick={() => void run.start()}>Start paper</Button>
            <Link to="/focus"><Button variant="ghost" size="lg">Cancel</Button></Link>
          </div>
        </Card>
      </Page>
    );
  }

  // --- live run -------------------------------------------------------------
  const current = run.current;
  const currentAttempt = current ? run.attempts[current.id] : undefined;
  const currentStatus: QuestionStatus = currentAttempt?.status ?? 'unattempted';
  const overtime = current ? run.currentQuestionMs > current.expectedSeconds * 1000 : false;
  const outOfTime = run.remainingMs !== null && run.remainingMs <= 0;

  const mark = async (status: QuestionStatus) => {
    if (!current) return;
    await setQuestionStatus(current.id, status);
    if (status !== 'incorrect' && status !== 'marked') await run.next();
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await run.submit();
      setConfirmSubmit(false);
      if (result) {
        const t = result.analytics.totals;
        toast.success(
          'Paper submitted',
          `${t.score}/${t.maxScore} marks · ${Math.round(t.accuracy * 100)}% accuracy${result.xpAwarded > 0 ? ` · +${result.xpAwarded} XP` : ''}`,
        );
        navigate(`/focus/paper/${paper.id}/review`);
      }
    } catch (e) {
      toast.error('Could not submit', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page
      title={paper.title}
      wide
      subtitle={`Question ${current ? current.index : '–'} of ${counts.total}`}
      actions={
        <div className="flex items-center gap-2">
          {run.paused ? (
            <Button variant="primary" iconLeft={<Play className="h-4 w-4" />} onClick={run.resume}>Resume</Button>
          ) : (
            <Button variant="secondary" iconLeft={<Pause className="h-4 w-4" />} onClick={() => void run.pause()}>Pause</Button>
          )}
          <Button variant="primary" iconLeft={<Flag className="h-4 w-4" />} onClick={() => setConfirmSubmit(true)}>
            Submit
          </Button>
        </div>
      }
    >
      {/* Global clock */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <div className="t-label">{paper.timed ? 'Time left' : 'Elapsed'}</div>
            <div
              className={cn(
                't-num text-2xl font-semibold tabular-nums',
                outOfTime ? 'text-critical' : run.paused ? 'text-ink-muted' : 'text-ink',
              )}
            >
              {formatClock(paper.timed && run.remainingMs !== null ? run.remainingMs : run.elapsedMs)}
            </div>
          </div>
          <div className="hidden sm:block">
            <div className="t-label">This question</div>
            <div className={cn('t-num text-2xl font-semibold tabular-nums', overtime ? 'text-caution' : 'text-ink')}>
              {formatClock(run.currentQuestionMs)}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Badge tone="positive">{counts.answered} answered</Badge>
            <Badge tone="caution">{counts.skipped} skipped</Badge>
            <Badge tone="accent">{counts.marked} marked</Badge>
            <Badge tone="neutral">{counts.untouched} left</Badge>
          </div>
        </div>
        {run.paused ? (
          <div className="mt-3 rounded-lg border border-caution/30 bg-caution/10 px-3 py-2 text-xs text-caution">
            Paused — the paper clock and this question&apos;s timer are stopped.
          </div>
        ) : null}
        {outOfTime ? (
          <div className="mt-3 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
            Time is up. Submit when you are ready — answers are still saved.
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* Question panel */}
        <Card>
          {current ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="t-title">Q{current.index}</span>
                <Badge tone="neutral">{sectionNames[current.sectionId]}</Badge>
                <Badge tone="neutral">
                  +{current.marks}
                  {current.negativeMarks > 0 ? ` / −${current.negativeMarks}` : ''}
                </Badge>
                <span className="t-meta ml-auto sm:hidden">{formatClock(run.currentQuestionMs)}</span>
              </div>

              <p className="t-meta mb-4">
                Target pace {formatDuration(current.expectedSeconds / 60)} ·{' '}
                {currentAttempt?.visits ? `${currentAttempt.visits} previous visit${currentAttempt.visits === 1 ? '' : 's'}` : 'first visit'}
                {overtime ? ' · running long' : ''}
              </p>

              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ANSWER_ACTIONS.map((a) => (
                  <button
                    key={a.status}
                    type="button"
                    disabled={run.paused}
                    onClick={() => void mark(a.status)}
                    className={cn(
                      'h-11 rounded-lg border text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                      a.tone,
                      currentStatus === a.status && 'ring-2 ring-accent/40',
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              {currentStatus === 'incorrect' ? (
                <div className="mb-4 rounded-lg border border-line bg-surface-sunken p-3">
                  <div className="t-label mb-2">Why was it wrong?</div>
                  <MistakePicker
                    size="sm"
                    value={currentAttempt?.mistakeType ?? null}
                    onChange={(type) => void setMistakeType(current.id, type)}
                  />
                  <p className="t-meta mt-2">You can change this later during review.</p>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="secondary"
                  iconLeft={<ChevronLeft className="h-4 w-4" />}
                  disabled={run.currentIndex <= 0}
                  onClick={() => void run.prev()}
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  iconLeft={<SkipForward className="h-4 w-4" />}
                  disabled={run.paused || run.currentIndex >= run.questions.length - 1}
                  onClick={() => void mark('skipped')}
                >
                  Skip
                </Button>
                <Button
                  variant="primary"
                  iconRight={<ChevronRight className="h-4 w-4" />}
                  disabled={run.currentIndex >= run.questions.length - 1}
                  onClick={() => void run.next()}
                >
                  Next
                </Button>
              </div>
            </>
          ) : (
            <div className="t-muted">Pick a question from the navigator.</div>
          )}
        </Card>

        {/* Navigator */}
        <Card>
          <div className="t-section mb-3">Navigator</div>
          <QuestionPalette
            questions={run.questions}
            attempts={run.attempts}
            currentId={current?.id ?? null}
            onSelect={(id) => void run.goTo(id)}
            sectionNames={sectionNames}
          />
        </Card>
      </div>

      <Modal
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title="Submit paper?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSubmit(false)}>Keep working</Button>
            <Button variant="primary" loading={submitting} onClick={() => void doSubmit()}>Submit paper</Button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="t-muted">
            {counts.answered} answered, {counts.skipped} skipped, {counts.marked} marked for review,{' '}
            {counts.untouched} never opened.
          </p>
          <p className="t-muted">
            Your score, per-question timings and mistake breakdown will be computed from what you recorded.
          </p>
        </div>
      </Modal>
    </Page>
  );
}
