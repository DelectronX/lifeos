import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import {
  accumulateVisit, loadRunState, runElapsedMs, runRemainingMs, saveRunState, startPaper,
  submitPaper, type PaperRunState, type SubmitPaperResult,
} from '@/services/paperService';
import type { ID, Paper, Question, QuestionAttempt } from '@/types';

/**
 * Owns the running-paper state machine.
 *
 * Two invariants make it refresh-proof and honest:
 *  1. Per-question time is only ever ACCUMULATED. Leaving a question closes its
 *     open visit and adds the elapsed wall-clock delta, so revisits sum up.
 *  2. The open visit's start timestamp and the paused-time total live in a
 *     localStorage snapshot, so a refresh mid-paper resumes on the same
 *     question with the same global clock.
 */
export interface PaperRun {
  paper: Paper | undefined;
  questions: Question[];
  attempts: Record<ID, QuestionAttempt>;
  attemptList: QuestionAttempt[];
  run: PaperRunState | null;
  current: Question | null;
  currentIndex: number;
  /** Live ms accumulated on the current question, including the open visit. */
  currentQuestionMs: number;
  elapsedMs: number;
  remainingMs: number | null;
  paused: boolean;
  loading: boolean;
  start: () => Promise<void>;
  goTo: (questionId: ID) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => void;
  submit: () => Promise<SubmitPaperResult | null>;
}

export function usePaperRun(paperId: ID | undefined): PaperRun {
  const paper = useLiveQuery(() => (paperId ? db.papers.get(paperId) : undefined), [paperId]);
  const questions = useLiveQuery(
    () => (paperId ? db.questions.where('paperId').equals(paperId).sortBy('index') : []),
    [paperId],
  ) ?? [];
  const attemptList = useLiveQuery(
    () => (paperId ? db.attempts.where('paperId').equals(paperId).toArray() : []),
    [paperId],
  ) ?? [];

  const [run, setRun] = useState<PaperRunState | null>(() => (paperId ? loadRunState(paperId) : null));
  const [, forceTick] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;

  // Restore an in-progress run after a refresh.
  useEffect(() => {
    if (!paperId) return;
    const restored = loadRunState(paperId);
    if (restored) setRun(restored);
  }, [paperId]);

  // 1s render tick while the paper is live; every number is still derived from
  // timestamps, so a throttled tab cannot cause drift.
  useEffect(() => {
    if (!run || run.pausedAt !== null) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [run, run?.pausedAt]);

  // Close the open visit when the tab is hidden or closed, so no time is lost.
  useEffect(() => {
    const flush = () => {
      const state = runRef.current;
      if (!state?.currentQuestionId || state.visitStartedAt === null) return;
      const now = Date.now();
      void accumulateVisit(state.currentQuestionId, state.visitStartedAt, now);
      const next = { ...state, visitStartedAt: now };
      saveRunState(next);
      runRef.current = next;
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  const attempts = useMemo(
    () => Object.fromEntries(attemptList.map((a) => [a.questionId, a])) as Record<ID, QuestionAttempt>,
    [attemptList],
  );

  const current = run?.currentQuestionId ? questions.find((q) => q.id === run.currentQuestionId) ?? null : null;
  const currentIndex = current ? questions.findIndex((q) => q.id === current.id) : -1;

  const now = Date.now();
  const openMs = run?.visitStartedAt !== null && run?.visitStartedAt !== undefined
    ? Math.max(0, now - run.visitStartedAt)
    : 0;
  const currentQuestionMs = current ? (attempts[current.id]?.timeSpentMs ?? 0) + openMs : 0;

  const elapsedMs = paper && run ? runElapsedMs(paper, run, now) : 0;
  const remainingMs = paper && run ? runRemainingMs(paper, run, now) : null;

  const start = useCallback(async () => {
    if (!paperId) return;
    const state = await startPaper(paperId);
    if (state) setRun(state);
  }, [paperId]);

  /** Navigation: bank the time on the question we are leaving, then move. */
  const goTo = useCallback(async (questionId: ID) => {
    const state = runRef.current;
    if (!state) return;
    const at = Date.now();
    if (state.currentQuestionId && state.visitStartedAt !== null && state.currentQuestionId !== questionId) {
      await accumulateVisit(state.currentQuestionId, state.visitStartedAt, at);
    }
    const next: PaperRunState = {
      ...state,
      currentQuestionId: questionId,
      visitStartedAt: state.pausedAt === null ? at : null,
    };
    saveRunState(next);
    setRun(next);
  }, []);

  const step = useCallback(async (delta: number) => {
    if (currentIndex < 0) return;
    const target = questions[currentIndex + delta];
    if (target) await goTo(target.id);
  }, [currentIndex, questions, goTo]);

  const pause = useCallback(async () => {
    const state = runRef.current;
    if (!state || state.pausedAt !== null) return;
    const at = Date.now();
    if (state.currentQuestionId && state.visitStartedAt !== null) {
      await accumulateVisit(state.currentQuestionId, state.visitStartedAt, at);
    }
    const next: PaperRunState = { ...state, pausedAt: at, visitStartedAt: null };
    saveRunState(next);
    setRun(next);
  }, []);

  const resume = useCallback(() => {
    const state = runRef.current;
    if (!state || state.pausedAt === null) return;
    const at = Date.now();
    const next: PaperRunState = {
      ...state,
      pausedMs: state.pausedMs + Math.max(0, at - state.pausedAt),
      pausedAt: null,
      visitStartedAt: at,
    };
    saveRunState(next);
    setRun(next);
  }, []);

  const submit = useCallback(async () => {
    if (!paperId) return null;
    const result = await submitPaper(paperId, runRef.current);
    setRun(null);
    return result;
  }, [paperId]);

  return {
    paper,
    questions,
    attempts,
    attemptList,
    run,
    current,
    currentIndex,
    currentQuestionMs,
    elapsedMs,
    remainingMs,
    paused: run?.pausedAt !== null && run?.pausedAt !== undefined,
    loading: paper === undefined,
    start,
    goTo,
    next: () => step(1),
    prev: () => step(-1),
    pause,
    resume,
    submit,
  };
}
