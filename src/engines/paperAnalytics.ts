import type {
  ID, MistakeType, Paper, PaperSection, Question, QuestionAttempt, QuestionStatus,
} from '@/types';

/**
 * PaperAnalyticsEngine — pure, deterministic analysis of one attempted paper.
 *
 * Rules of this module (mirrors the other engines):
 *   - no Dexie, no React, no imports from services
 *   - no `Date.now()`; anything time-relative takes an explicit `now`
 *   - every number is derived from the stored Question/QuestionAttempt rows,
 *     so the review UI can never show a figure that isn't in the database
 *
 * Terminology used consistently below:
 *   attempted   = the user answered it (status correct | incorrect)
 *   skipped     = deliberately left (status skipped)
 *   marked      = flagged for review and never resolved (status marked)
 *   untouched   = status unattempted
 *   timed       = an attempt that accumulated any wall-clock time at all;
 *                 per-question time statistics are computed over these only,
 *                 because a question the user never opened has no meaningful
 *                 "time per question" to average.
 */

/* ------------------------------------------------------------------ */
/* Result shapes                                                       */
/* ------------------------------------------------------------------ */

export interface TimeStats {
  /** Number of questions the stats were computed over (timed questions). */
  samples: number;
  totalMs: number;
  averageMs: number;
  medianMs: number;
  fastestMs: number;
  slowestMs: number;
}

export interface PaperTotals {
  questions: number;
  attempted: number;
  correct: number;
  incorrect: number;
  skipped: number;
  marked: number;
  untouched: number;
  score: number;
  maxScore: number;
  /** score / maxScore, 0..1 (clamped at 0 so negative marking can't go below). */
  scorePct: number;
  /** correct / attempted, 0..1. Zero when nothing was attempted. */
  accuracy: number;
  /** attempted / questions, 0..1. */
  attemptRate: number;
  /** Wall-clock time recorded across every question, in ms. */
  totalTimeMs: number;
  /** Total time the paper was open, when it was actually run. */
  elapsedMs: number | null;
  time: TimeStats;
  averageCorrectMs: number;
  averageIncorrectMs: number;
}

export interface SectionAnalytics {
  sectionId: ID;
  name: string;
  trackerId: ID;
  questions: number;
  attempted: number;
  correct: number;
  incorrect: number;
  skipped: number;
  marked: number;
  untouched: number;
  score: number;
  maxScore: number;
  accuracy: number;
  attemptRate: number;
  totalTimeMs: number;
  averageMs: number;
  medianMs: number;
}

export interface QuestionAnalytics {
  questionId: ID;
  attemptId: ID | null;
  index: number;
  sectionId: ID;
  sectionName: string;
  trackerId: ID;
  topic?: string;
  status: QuestionStatus;
  marks: number;
  negativeMarks: number;
  /** Marks this question actually contributed (may be negative). */
  earned: number;
  timeSpentMs: number;
  visits: number;
  expectedMs: number;
  /** timeSpentMs - expectedMs. Positive means the question ran long. */
  overtimeMs: number;
  mistakeType: MistakeType | null;
  confidence: 1 | 2 | 3 | 4 | 5 | null;
  notes?: string;
}

export interface MistakeAggregate {
  type: MistakeType;
  label: string;
  count: number;
  /** Share of all classified mistakes, 0..1. */
  share: number;
  /** Share of every incorrect question, 0..1. */
  shareOfIncorrect: number;
  /** Marks lost to this mistake type (positive number). */
  marksLost: number;
  averageTimeMs: number;
}

export interface PaperAnalytics {
  paperId: ID;
  title: string;
  status: Paper['status'];
  date: string;
  durationMs: number;
  totals: PaperTotals;
  sections: SectionAnalytics[];
  questions: QuestionAnalytics[];
  mistakes: MistakeAggregate[];
  /** Incorrect questions with no mistake type recorded yet. */
  unclassifiedMistakes: number;
  pacing: {
    /** Sum of every question's expected time. */
    expectedMs: number;
    /** Questions whose real time exceeded their expected time. */
    overtimeQuestions: number;
    /** Time budget left over (or overspent, when negative). */
    budgetRemainingMs: number;
  };
}

export const MISTAKE_LABELS: Record<MistakeType, string> = {
  unknown_concept: "Didn't know concept",
  conceptual: 'Conceptual',
  calculation: 'Calculation',
  silly: 'Silly',
  misread: 'Misread',
  time_pressure: 'Time pressure',
  guess: 'Guess',
  other: 'Other',
};

/** Stable display order for mistake pickers and charts. */
export const MISTAKE_TYPES: MistakeType[] = [
  'unknown_concept', 'conceptual', 'calculation', 'silly',
  'misread', 'time_pressure', 'guess', 'other',
];

/* ------------------------------------------------------------------ */
/* Statistics helpers (exported: used by tests and by other rollups)    */
/* ------------------------------------------------------------------ */

/** Arithmetic mean; 0 for an empty sample. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Median. For an even-sized sample this is the mean of the two central
 * values, not the lower one — so [10, 20, 30, 40] is 25, never 20.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function timeStats(values: number[]): TimeStats {
  const timed = values.filter((v) => v > 0);
  if (timed.length === 0) {
    return { samples: 0, totalMs: 0, averageMs: 0, medianMs: 0, fastestMs: 0, slowestMs: 0 };
  }
  return {
    samples: timed.length,
    totalMs: timed.reduce((a, b) => a + b, 0),
    averageMs: mean(timed),
    medianMs: median(timed),
    fastestMs: Math.min(...timed),
    slowestMs: Math.max(...timed),
  };
}

function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Marks contributed by one question. Correct pays `marks`, incorrect costs
 * `negativeMarks`, everything else is worth nothing. Negative marking is a
 * property of the question row, so per-section schemes work automatically.
 */
export function earnedMarks(question: Question, status: QuestionStatus): number {
  if (status === 'correct') return question.marks;
  if (status === 'incorrect') return -Math.abs(question.negativeMarks);
  return 0;
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

export interface PaperAnalyticsInput {
  paper: Paper;
  questions: Question[];
  attempts: QuestionAttempt[];
  /**
   * Reference time. Only used when the paper is still running and has no
   * `submittedAt`, to report how long it has been open.
   */
  now?: Date;
}

export function analysePaper({ paper, questions, attempts, now }: PaperAnalyticsInput): PaperAnalytics {
  const byQuestion = new Map<ID, QuestionAttempt>();
  for (const a of attempts) byQuestion.set(a.questionId, a);

  const sectionById = new Map<ID, PaperSection>();
  for (const s of paper.sections) sectionById.set(s.id, s);

  const ordered = [...questions].sort((a, b) => a.index - b.index);

  const rows: QuestionAnalytics[] = ordered.map((q) => {
    const attempt = byQuestion.get(q.id) ?? null;
    const status: QuestionStatus = attempt?.status ?? 'unattempted';
    const timeSpentMs = Math.max(0, attempt?.timeSpentMs ?? 0);
    const expectedMs = Math.max(0, q.expectedSeconds) * 1000;
    return {
      questionId: q.id,
      attemptId: attempt?.id ?? null,
      index: q.index,
      sectionId: q.sectionId,
      sectionName: sectionById.get(q.sectionId)?.name ?? 'Section',
      trackerId: q.trackerId,
      topic: q.topic,
      status,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      earned: earnedMarks(q, status),
      timeSpentMs,
      visits: attempt?.visits ?? 0,
      expectedMs,
      overtimeMs: timeSpentMs > 0 ? timeSpentMs - expectedMs : 0,
      mistakeType: attempt?.mistakeType ?? null,
      confidence: attempt?.confidence ?? null,
      notes: attempt?.notes,
    };
  });

  const count = (pred: (r: QuestionAnalytics) => boolean) => rows.filter(pred).length;
  const correct = count((r) => r.status === 'correct');
  const incorrect = count((r) => r.status === 'incorrect');
  const skipped = count((r) => r.status === 'skipped');
  const marked = count((r) => r.status === 'marked');
  const untouched = count((r) => r.status === 'unattempted');
  const attempted = correct + incorrect;

  const score = rows.reduce((sum, r) => sum + r.earned, 0);
  const maxScore = rows.reduce((sum, r) => sum + r.marks, 0);
  const totalTimeMs = rows.reduce((sum, r) => sum + r.timeSpentMs, 0);

  const totals: PaperTotals = {
    questions: rows.length,
    attempted,
    correct,
    incorrect,
    skipped,
    marked,
    untouched,
    score,
    maxScore,
    scorePct: Math.max(0, safeDiv(score, maxScore)),
    accuracy: safeDiv(correct, attempted),
    attemptRate: safeDiv(attempted, rows.length),
    totalTimeMs,
    elapsedMs: elapsedFor(paper, now),
    time: timeStats(rows.map((r) => r.timeSpentMs)),
    averageCorrectMs: mean(rows.filter((r) => r.status === 'correct' && r.timeSpentMs > 0).map((r) => r.timeSpentMs)),
    averageIncorrectMs: mean(rows.filter((r) => r.status === 'incorrect' && r.timeSpentMs > 0).map((r) => r.timeSpentMs)),
  };

  const sections: SectionAnalytics[] = paper.sections.map((section) => {
    const sectionRows = rows.filter((r) => r.sectionId === section.id);
    const sCorrect = sectionRows.filter((r) => r.status === 'correct').length;
    const sIncorrect = sectionRows.filter((r) => r.status === 'incorrect').length;
    const sAttempted = sCorrect + sIncorrect;
    const times = sectionRows.map((r) => r.timeSpentMs).filter((v) => v > 0);
    return {
      sectionId: section.id,
      name: section.name,
      trackerId: section.trackerId,
      questions: sectionRows.length,
      attempted: sAttempted,
      correct: sCorrect,
      incorrect: sIncorrect,
      skipped: sectionRows.filter((r) => r.status === 'skipped').length,
      marked: sectionRows.filter((r) => r.status === 'marked').length,
      untouched: sectionRows.filter((r) => r.status === 'unattempted').length,
      score: sectionRows.reduce((sum, r) => sum + r.earned, 0),
      maxScore: sectionRows.reduce((sum, r) => sum + r.marks, 0),
      accuracy: safeDiv(sCorrect, sAttempted),
      attemptRate: safeDiv(sAttempted, sectionRows.length),
      totalTimeMs: sectionRows.reduce((sum, r) => sum + r.timeSpentMs, 0),
      averageMs: mean(times),
      medianMs: median(times),
    };
  });

  const incorrectRows = rows.filter((r) => r.status === 'incorrect');
  const classified = incorrectRows.filter((r) => r.mistakeType !== null);

  const mistakes: MistakeAggregate[] = MISTAKE_TYPES
    .map((type) => {
      const group = classified.filter((r) => r.mistakeType === type);
      return {
        type,
        label: MISTAKE_LABELS[type],
        count: group.length,
        share: safeDiv(group.length, classified.length),
        shareOfIncorrect: safeDiv(group.length, incorrectRows.length),
        marksLost: group.reduce((sum, r) => sum + r.marks + Math.abs(r.negativeMarks), 0),
        averageTimeMs: mean(group.map((r) => r.timeSpentMs).filter((v) => v > 0)),
      };
    })
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  const expectedMs = rows.reduce((sum, r) => sum + r.expectedMs, 0);

  return {
    paperId: paper.id,
    title: paper.title,
    status: paper.status,
    date: paper.date,
    durationMs: paper.durationMinutes * 60_000,
    totals,
    sections,
    questions: rows,
    mistakes,
    unclassifiedMistakes: incorrectRows.length - classified.length,
    pacing: {
      expectedMs,
      overtimeQuestions: rows.filter((r) => r.timeSpentMs > 0 && r.timeSpentMs > r.expectedMs).length,
      budgetRemainingMs: paper.durationMinutes * 60_000 - totalTimeMs,
    },
  };
}

function elapsedFor(paper: Paper, now?: Date): number | null {
  if (paper.startedAt === null) return null;
  const end = paper.submittedAt ?? (now ? now.getTime() : null);
  if (end === null) return null;
  return Math.max(0, end - paper.startedAt);
}

/* ------------------------------------------------------------------ */
/* Sorting for the review table                                        */
/* ------------------------------------------------------------------ */

export type QuestionSortKey =
  | 'index' | 'longest' | 'shortest' | 'incorrect' | 'skipped' | 'mistake' | 'visits';

export const QUESTION_SORT_LABELS: Record<QuestionSortKey, string> = {
  index: 'Question order',
  longest: 'Longest time first',
  shortest: 'Shortest time first',
  incorrect: 'Incorrect first',
  skipped: 'Skipped first',
  mistake: 'By mistake type',
  visits: 'Most revisited',
};

const STATUS_RANK: Record<QuestionStatus, number> = {
  incorrect: 0, marked: 1, skipped: 2, unattempted: 3, correct: 4,
};

/** Pure, stable sort used by the review table. Never mutates the input. */
export function sortQuestions(rows: QuestionAnalytics[], key: QuestionSortKey): QuestionAnalytics[] {
  const out = [...rows];
  const byIndex = (a: QuestionAnalytics, b: QuestionAnalytics) => a.index - b.index;
  switch (key) {
    case 'longest':
      return out.sort((a, b) => b.timeSpentMs - a.timeSpentMs || byIndex(a, b));
    case 'shortest':
      // Questions never opened have no time to compare — they sort last.
      return out.sort((a, b) => {
        if (a.timeSpentMs === 0 && b.timeSpentMs === 0) return byIndex(a, b);
        if (a.timeSpentMs === 0) return 1;
        if (b.timeSpentMs === 0) return -1;
        return a.timeSpentMs - b.timeSpentMs || byIndex(a, b);
      });
    case 'incorrect':
      return out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byIndex(a, b));
    case 'skipped':
      return out.sort((a, b) => rankSkipped(a) - rankSkipped(b) || byIndex(a, b));
    case 'mistake':
      return out.sort((a, b) => mistakeRank(a) - mistakeRank(b) || byIndex(a, b));
    case 'visits':
      return out.sort((a, b) => b.visits - a.visits || byIndex(a, b));
    case 'index':
    default:
      return out.sort(byIndex);
  }
}

function rankSkipped(r: QuestionAnalytics): number {
  if (r.status === 'skipped') return 0;
  if (r.status === 'unattempted') return 1;
  if (r.status === 'marked') return 2;
  return 3;
}

function mistakeRank(r: QuestionAnalytics): number {
  if (r.mistakeType === null) return MISTAKE_TYPES.length + (r.status === 'incorrect' ? 0 : 1);
  return MISTAKE_TYPES.indexOf(r.mistakeType);
}
