import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { toDateKey, todayKey } from '@/lib/date';
import { logActivity } from './activityService';
import { awardXP } from './timerService';
import { analysePaper, type PaperAnalytics } from '@/engines/paperAnalytics';
import type {
  DateKey, ID, MistakeType, Paper, PaperSection, Question, QuestionAttempt, QuestionStatus,
  TimerSession,
} from '@/types';

/**
 * PaperService — persistence for Paper Mode.
 *
 * Per-question timing rule: time is ACCUMULATED, never overwritten. Navigating
 * away from a question closes its open visit and adds the elapsed wall-clock
 * time to `timeSpentMs`, so revisiting a question keeps every earlier second.
 * The open visit's start timestamp lives in a small localStorage snapshot
 * alongside the paper run, which is what makes a mid-paper refresh lossless.
 */

const RUN_KEY = 'lifeos.paper.run';

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export interface SectionDraft {
  name: string;
  trackerId: ID;
  questionCount: number;
  marksPerQuestion: number;
  negativeMarks: number;
}

export interface PaperDraft {
  title: string;
  sections: SectionDraft[];
  durationMinutes: number;
  timed: boolean;
  date: DateKey;
  notes?: string;
}

export interface PaperDraftIssue {
  field: string;
  message: string;
}

/** Pure validation so the builder can show errors without touching the DB. */
export function validatePaperDraft(draft: PaperDraft): PaperDraftIssue[] {
  const issues: PaperDraftIssue[] = [];
  if (!draft.title.trim()) issues.push({ field: 'title', message: 'Give the paper a name.' });
  if (draft.sections.length === 0) issues.push({ field: 'sections', message: 'Add at least one subject section.' });
  if (draft.durationMinutes < 1) issues.push({ field: 'durationMinutes', message: 'Duration must be at least 1 minute.' });
  draft.sections.forEach((s, i) => {
    if (!s.name.trim()) issues.push({ field: `sections.${i}.name`, message: 'Section name is required.' });
    if (!s.trackerId) issues.push({ field: `sections.${i}.trackerId`, message: 'Pick a tracker for this section.' });
    if (s.questionCount < 1) issues.push({ field: `sections.${i}.questionCount`, message: 'At least one question.' });
    if (s.marksPerQuestion <= 0) issues.push({ field: `sections.${i}.marksPerQuestion`, message: 'Marks must be positive.' });
  });
  return issues;
}

export function totalQuestions(draft: PaperDraft): number {
  return draft.sections.reduce((sum, s) => sum + Math.max(0, Math.round(s.questionCount)), 0);
}

export function totalMarks(draft: PaperDraft): number {
  return draft.sections.reduce((sum, s) => sum + Math.max(0, s.questionCount) * s.marksPerQuestion, 0);
}

/** Even time budget per question, in seconds — the pacing baseline. */
export function expectedSecondsPerQuestion(draft: PaperDraft): number {
  const q = totalQuestions(draft);
  if (q === 0) return 0;
  return Math.round((draft.durationMinutes * 60) / q);
}

/**
 * Creates the Paper row plus one Question row per slot. Questions are numbered
 * 1..N across the whole paper so the runner's palette is a single flat grid.
 */
export async function createPaper(draft: PaperDraft): Promise<Paper> {
  const now = Date.now();
  const sections: PaperSection[] = draft.sections.map((s) => ({
    id: newId('sec'),
    name: s.name.trim(),
    trackerId: s.trackerId,
    questionCount: Math.max(1, Math.round(s.questionCount)),
    marksPerQuestion: s.marksPerQuestion,
    negativeMarks: Math.abs(s.negativeMarks),
  }));

  const perQuestionSeconds = expectedSecondsPerQuestion(draft);
  const questions: Question[] = [];
  let index = 1;
  for (const section of sections) {
    for (let i = 0; i < section.questionCount; i++) {
      questions.push({
        id: newId('qst'),
        createdAt: now,
        updatedAt: now,
        paperId: '',
        sectionId: section.id,
        index: index++,
        trackerId: section.trackerId,
        marks: section.marksPerQuestion,
        negativeMarks: section.negativeMarks,
        expectedSeconds: perQuestionSeconds,
      });
    }
  }

  const paper: Paper = {
    id: newId('pap'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    sections,
    durationMinutes: Math.max(1, Math.round(draft.durationMinutes)),
    timed: draft.timed,
    status: 'draft',
    startedAt: null,
    submittedAt: null,
    date: draft.date || todayKey(),
    score: 0,
    maxScore: questions.reduce((sum, q) => sum + q.marks, 0),
    notes: draft.notes?.trim() || undefined,
  };

  for (const q of questions) q.paperId = paper.id;

  await db.transaction('rw', [db.papers, db.questions], async () => {
    await db.papers.add(paper);
    await db.questions.bulkAdd(questions);
  });

  return paper;
}

export async function deletePaper(id: ID): Promise<void> {
  await db.transaction('rw', [db.papers, db.questions, db.attempts, db.activities, db.sessions], async () => {
    const questions = await db.questions.where('paperId').equals(id).toArray();
    const attempts = await db.attempts.where('paperId').equals(id).toArray();
    await db.questions.bulkDelete(questions.map((q) => q.id));
    await db.attempts.bulkDelete(attempts.map((a) => a.id));
    const acts = await db.activities.where('paperId').equals(id).toArray();
    await db.activities.bulkDelete(acts.map((a) => a.id));
    await db.papers.delete(id);
  });
  clearRunState(id);
}

export async function updatePaper(id: ID, patch: Partial<Paper>): Promise<void> {
  await db.papers.update(id, { ...patch, updatedAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getPaperBundle(paperId: ID): Promise<{
  paper: Paper | undefined;
  questions: Question[];
  attempts: QuestionAttempt[];
}> {
  const [paper, questions, attempts] = await Promise.all([
    db.papers.get(paperId),
    db.questions.where('paperId').equals(paperId).sortBy('index'),
    db.attempts.where('paperId').equals(paperId).toArray(),
  ]);
  return { paper, questions, attempts };
}

export async function analyse(paperId: ID, now: Date = new Date()): Promise<PaperAnalytics | null> {
  const { paper, questions, attempts } = await getPaperBundle(paperId);
  if (!paper) return null;
  return analysePaper({ paper, questions, attempts, now });
}

/* ------------------------------------------------------------------ */
/* Run state (survives refresh)                                        */
/* ------------------------------------------------------------------ */

export interface PaperRunState {
  paperId: ID;
  /** The question currently on screen. */
  currentQuestionId: ID | null;
  /** Wall-clock start of the OPEN visit to `currentQuestionId`; null when paused. */
  visitStartedAt: number | null;
  /** Ms the whole paper has been paused for, so the global clock stays honest. */
  pausedMs: number;
  /** Set while paused, to accumulate `pausedMs` on resume. */
  pausedAt: number | null;
  /** TimerSession-style id reserved for the paper's own session row. */
  sessionId: ID;
}

export function loadRunState(paperId: ID): PaperRunState | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PaperRunState;
    if (!parsed || parsed.paperId !== paperId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRunState(state: PaperRunState | null): void {
  try {
    if (state === null) localStorage.removeItem(RUN_KEY);
    else localStorage.setItem(RUN_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — the run still works for this tab */
  }
}

export function clearRunState(paperId?: ID): void {
  if (!paperId) { saveRunState(null); return; }
  const existing = loadRunState(paperId);
  if (existing) saveRunState(null);
}

/**
 * Elapsed run time excluding paused stretches. Pure.
 */
export function runElapsedMs(paper: Paper, run: PaperRunState, now: number): number {
  if (paper.startedAt === null) return 0;
  const pausedNow = run.pausedAt === null ? 0 : Math.max(0, now - run.pausedAt);
  return Math.max(0, now - paper.startedAt - run.pausedMs - pausedNow);
}

/** Ms left on the global paper clock; null when the paper is untimed. */
export function runRemainingMs(paper: Paper, run: PaperRunState, now: number): number | null {
  if (!paper.timed) return null;
  return Math.max(0, paper.durationMinutes * 60_000 - runElapsedMs(paper, run, now));
}

/* ------------------------------------------------------------------ */
/* Attempts                                                            */
/* ------------------------------------------------------------------ */

function buildAttempt(question: Question, now: number): QuestionAttempt {
  return {
    id: newId('atp'),
    createdAt: now,
    updatedAt: now,
    questionId: question.id,
    paperId: question.paperId,
    sectionId: question.sectionId,
    trackerId: question.trackerId,
    status: 'unattempted',
    timeSpentMs: 0,
    visits: 0,
    mistakeType: null,
    confidence: null,
    attemptedAt: null,
  };
}

/** Fetches or lazily creates the attempt row for a question. */
export async function ensureAttempt(questionId: ID): Promise<QuestionAttempt> {
  const existing = await db.attempts.where('questionId').equals(questionId).first();
  if (existing) return existing;
  const question = await db.questions.get(questionId);
  if (!question) throw new Error('Question not found');
  const attempt = buildAttempt(question, Date.now());
  await db.attempts.add(attempt);
  return attempt;
}

/**
 * Starts the paper: stamps `startedAt`, flips status, and pre-creates every
 * attempt row so the palette can render statuses without N lazy writes.
 */
export async function startPaper(paperId: ID): Promise<PaperRunState | null> {
  const now = Date.now();
  const { paper, questions, attempts } = await getPaperBundle(paperId);
  if (!paper) return null;

  const have = new Set(attempts.map((a) => a.questionId));
  const missing = questions.filter((q) => !have.has(q.id)).map((q) => buildAttempt(q, now));
  await db.transaction('rw', [db.papers, db.attempts], async () => {
    if (missing.length) await db.attempts.bulkAdd(missing);
    await db.papers.update(paperId, {
      status: 'in_progress',
      startedAt: paper.startedAt ?? now,
      updatedAt: now,
    });
  });

  const state: PaperRunState = {
    paperId,
    currentQuestionId: questions[0]?.id ?? null,
    visitStartedAt: now,
    pausedMs: 0,
    pausedAt: null,
    sessionId: newId('ses'),
  };
  saveRunState(state);
  return state;
}

/**
 * Closes the open visit on `questionId`, ADDING the elapsed time to whatever
 * was already recorded. Called on every navigation, pause and submit.
 */
export async function accumulateVisit(questionId: ID, startedAt: number, now = Date.now()): Promise<number> {
  const delta = Math.max(0, now - startedAt);
  if (delta < 250) return 0; // ignore accidental flicks through the palette
  const attempt = await ensureAttempt(questionId);
  await db.attempts.update(attempt.id, {
    timeSpentMs: attempt.timeSpentMs + delta,
    visits: attempt.visits + 1,
    updatedAt: now,
  });
  return delta;
}

export async function setQuestionStatus(questionId: ID, status: QuestionStatus): Promise<void> {
  const attempt = await ensureAttempt(questionId);
  const now = Date.now();
  await db.attempts.update(attempt.id, {
    status,
    attemptedAt: status === 'unattempted' ? null : (attempt.attemptedAt ?? now),
    // Clearing an incorrect answer must not leave a stale mistake classification.
    mistakeType: status === 'incorrect' ? attempt.mistakeType : null,
    updatedAt: now,
  });
}

export async function setMistakeType(questionId: ID, mistakeType: MistakeType | null): Promise<void> {
  const attempt = await ensureAttempt(questionId);
  await db.attempts.update(attempt.id, { mistakeType, updatedAt: Date.now() });
}

export async function setQuestionNotes(questionId: ID, notes: string): Promise<void> {
  const attempt = await ensureAttempt(questionId);
  await db.attempts.update(attempt.id, { notes: notes.trim() || undefined, updatedAt: Date.now() });
}

export async function setConfidence(questionId: ID, confidence: 1 | 2 | 3 | 4 | 5 | null): Promise<void> {
  const attempt = await ensureAttempt(questionId);
  await db.attempts.update(attempt.id, { confidence, updatedAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Submission                                                          */
/* ------------------------------------------------------------------ */

export interface SubmitPaperResult {
  analytics: PaperAnalytics;
  session: TimerSession;
  xpAwarded: number;
  xpNote?: string;
}

/**
 * Submits the paper: closes the open visit, recomputes the score from the
 * stored attempts, writes a real TimerSession + Activity for the attempt and
 * awards XP. Nothing here is cosmetic — every downstream analytic reads these
 * rows.
 */
export async function submitPaper(
  paperId: ID,
  run: PaperRunState | null,
  now = Date.now(),
): Promise<SubmitPaperResult | null> {
  if (run?.currentQuestionId && run.visitStartedAt !== null) {
    await accumulateVisit(run.currentQuestionId, run.visitStartedAt, now);
  }

  const { paper, questions, attempts } = await getPaperBundle(paperId);
  if (!paper) return null;

  const analytics = analysePaper({ paper, questions, attempts, now: new Date(now) });

  await db.papers.update(paperId, {
    status: 'submitted',
    submittedAt: now,
    score: analytics.totals.score,
    maxScore: analytics.totals.maxScore,
    updatedAt: now,
  });

  const startedAt = paper.startedAt ?? now - analytics.totals.totalTimeMs;
  const workMs = run ? runElapsedMs({ ...paper, startedAt }, run, now) : analytics.totals.totalTimeMs;

  const session: TimerSession = {
    id: run?.sessionId ?? newId('ses'),
    createdAt: startedAt,
    updatedAt: now,
    mode: 'paper',
    taskId: null,
    blockId: null,
    goalId: null,
    trackerId: paper.sections[0]?.trackerId ?? 'trk_study',
    paperId,
    startedAt,
    endedAt: now,
    workMs: Math.round(Math.max(workMs, analytics.totals.totalTimeMs)),
    breakMs: run ? Math.round(run.pausedMs) : 0,
    plannedMs: paper.durationMinutes * 60_000,
    segments: [{ start: startedAt, end: now, phase: 'work' }],
    pomodoroCount: 0,
    interruptions: 0,
    completed: true,
    date: toDateKey(startedAt),
  };
  await db.sessions.add(session);

  const activity = await logActivity({
    type: 'paper_submitted',
    title: paper.title,
    at: now,
    trackerId: session.trackerId,
    paperId,
    sessionId: session.id,
    durationMs: session.workMs,
    value: analytics.totals.score,
    unit: 'marks',
    meta: {
      maxScore: analytics.totals.maxScore,
      accuracy: analytics.totals.accuracy,
      attempted: analytics.totals.attempted,
      correct: analytics.totals.correct,
      incorrect: analytics.totals.incorrect,
      skipped: analytics.totals.skipped,
      questions: analytics.totals.questions,
    },
  });

  const award = await awardXP({
    reason: 'paper_submitted',
    sourceType: 'paper',
    sourceId: paperId,
    minutes: session.workMs / 60_000,
    description: `${paper.title} — ${analytics.totals.score}/${analytics.totals.maxScore}`,
  }, activity.id);

  clearRunState(paperId);

  return { analytics, session, xpAwarded: award.amount, xpNote: award.note };
}

/** Moves a submitted paper into the reviewed state once mistakes are classified. */
export async function markReviewed(paperId: ID): Promise<void> {
  await db.papers.update(paperId, { status: 'reviewed', updatedAt: Date.now() });
}

/** Recomputes and re-caches the cached score after a review-time edit. */
export async function refreshPaperScore(paperId: ID): Promise<void> {
  const analytics = await analyse(paperId);
  if (!analytics) return;
  await db.papers.update(paperId, {
    score: analytics.totals.score,
    maxScore: analytics.totals.maxScore,
    updatedAt: Date.now(),
  });
}
