import { describe, expect, it } from 'vitest';
import {
  analysePaper, earnedMarks, MISTAKE_TYPES, median, mean, sortQuestions, timeStats,
} from '@/engines/paperAnalytics';
import type {
  ID, MistakeType, Paper, PaperSection, Question, QuestionAttempt, QuestionStatus,
} from '@/types';

/* ------------------------------------------------------------------ */
/* Fixtures — fully deterministic, no wall clock                       */
/* ------------------------------------------------------------------ */

const DAY = '2026-03-02';
const START = new Date(`${DAY}T09:00:00`).getTime();
const SEC = 1000;

function section(over: Partial<PaperSection> & { id: ID; name: string }): PaperSection {
  return {
    trackerId: 'trk_study',
    questionCount: 0,
    marksPerQuestion: 4,
    negativeMarks: 1,
    ...over,
  };
}

function paper(sections: PaperSection[], over: Partial<Paper> = {}): Paper {
  return {
    id: 'pap_1',
    createdAt: START,
    updatedAt: START,
    title: 'Mock Test 1',
    sections,
    durationMinutes: 60,
    timed: true,
    status: 'submitted',
    startedAt: START,
    submittedAt: START + 40 * 60 * 1000,
    date: DAY,
    score: 0,
    maxScore: 0,
    ...over,
  };
}

interface QSpec {
  index: number;
  sectionId: ID;
  status?: QuestionStatus;
  timeSec?: number;
  marks?: number;
  negativeMarks?: number;
  expectedSeconds?: number;
  mistakeType?: MistakeType | null;
  visits?: number;
  /** When false, no QuestionAttempt row exists at all. */
  attempt?: boolean;
}

function build(specs: QSpec[]): { questions: Question[]; attempts: QuestionAttempt[] } {
  const questions: Question[] = [];
  const attempts: QuestionAttempt[] = [];
  for (const s of specs) {
    const id = `q_${s.index}`;
    questions.push({
      id,
      createdAt: START,
      updatedAt: START,
      paperId: 'pap_1',
      sectionId: s.sectionId,
      index: s.index,
      trackerId: 'trk_study',
      marks: s.marks ?? 4,
      negativeMarks: s.negativeMarks ?? 1,
      expectedSeconds: s.expectedSeconds ?? 60,
    });
    if (s.attempt === false) continue;
    attempts.push({
      id: `att_${s.index}`,
      createdAt: START,
      updatedAt: START,
      questionId: id,
      paperId: 'pap_1',
      sectionId: s.sectionId,
      trackerId: 'trk_study',
      status: s.status ?? 'unattempted',
      timeSpentMs: (s.timeSec ?? 0) * SEC,
      visits: s.visits ?? (s.timeSec ? 1 : 0),
      mistakeType: s.mistakeType ?? null,
      confidence: null,
      attemptedAt: s.status && s.status !== 'unattempted' ? START : null,
    });
  }
  return { questions, attempts };
}

/* ------------------------------------------------------------------ */

describe('paperAnalytics — statistics primitives', () => {
  it('median of an odd sample is the middle value', () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it('median of an even sample averages the two central values', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([40, 10, 30, 20])).toBe(25);
    expect(median([1, 2])).toBe(1.5);
  });

  it('median and mean of an empty sample are 0, not NaN', () => {
    expect(median([])).toBe(0);
    expect(mean([])).toBe(0);
    expect(Number.isNaN(median([]))).toBe(false);
  });

  it('timeStats ignores zero-time entries and reports fastest/slowest', () => {
    const s = timeStats([0, 5000, 15000, 0, 10000]);
    expect(s.samples).toBe(3);
    expect(s.totalMs).toBe(30000);
    expect(s.fastestMs).toBe(5000);
    expect(s.slowestMs).toBe(15000);
    expect(s.medianMs).toBe(10000);
    expect(s.averageMs).toBe(10000);
  });

  it('timeStats over no timed questions returns all zeros', () => {
    const s = timeStats([0, 0]);
    expect(s).toEqual({ samples: 0, totalMs: 0, averageMs: 0, medianMs: 0, fastestMs: 0, slowestMs: 0 });
  });
});

describe('paperAnalytics — scoring', () => {
  const q: Question = {
    id: 'q', createdAt: 0, updatedAt: 0, paperId: 'p', sectionId: 's', index: 1,
    trackerId: 't', marks: 4, negativeMarks: 1, expectedSeconds: 60,
  };

  it('awards full marks for correct, negative for incorrect, zero otherwise', () => {
    expect(earnedMarks(q, 'correct')).toBe(4);
    expect(earnedMarks(q, 'incorrect')).toBe(-1);
    expect(earnedMarks(q, 'skipped')).toBe(0);
    expect(earnedMarks(q, 'marked')).toBe(0);
    expect(earnedMarks(q, 'unattempted')).toBe(0);
  });

  it('computes score, accuracy and attempt rate from the stored attempts', () => {
    const sec = section({ id: 's1', name: 'Physics' });
    const { questions, attempts } = build([
      { index: 1, sectionId: 's1', status: 'correct', timeSec: 30 },
      { index: 2, sectionId: 's1', status: 'correct', timeSec: 60 },
      { index: 3, sectionId: 's1', status: 'incorrect', timeSec: 90, mistakeType: 'calculation' },
      { index: 4, sectionId: 's1', status: 'skipped', timeSec: 10 },
      { index: 5, sectionId: 's1', attempt: false },
    ]);
    const a = analysePaper({ paper: paper([sec]), questions, attempts });

    expect(a.totals.questions).toBe(5);
    expect(a.totals.correct).toBe(2);
    expect(a.totals.incorrect).toBe(1);
    expect(a.totals.skipped).toBe(1);
    expect(a.totals.untouched).toBe(1);
    expect(a.totals.attempted).toBe(3);
    // 4 + 4 - 1
    expect(a.totals.score).toBe(7);
    expect(a.totals.maxScore).toBe(20);
    expect(a.totals.accuracy).toBeCloseTo(2 / 3, 6);
    expect(a.totals.attemptRate).toBeCloseTo(3 / 5, 6);
    expect(a.totals.totalTimeMs).toBe(190 * SEC);
    // Timed questions: 30, 60, 90, 10 -> median = (30+60)/2
    expect(a.totals.time.samples).toBe(4);
    expect(a.totals.time.medianMs).toBe(45 * SEC);
    expect(a.totals.time.fastestMs).toBe(10 * SEC);
    expect(a.totals.time.slowestMs).toBe(90 * SEC);
    expect(a.totals.averageCorrectMs).toBe(45 * SEC);
    expect(a.totals.averageIncorrectMs).toBe(90 * SEC);
  });

  it('never reports a negative score percentage even under heavy negative marking', () => {
    const sec = section({ id: 's1', name: 'Chem' });
    const { questions, attempts } = build([
      { index: 1, sectionId: 's1', status: 'incorrect', timeSec: 20, marks: 4, negativeMarks: 2 },
      { index: 2, sectionId: 's1', status: 'incorrect', timeSec: 20, marks: 4, negativeMarks: 2 },
    ]);
    const a = analysePaper({ paper: paper([sec]), questions, attempts });
    expect(a.totals.score).toBe(-4);
    expect(a.totals.scorePct).toBe(0);
  });
});

describe('paperAnalytics — zero-attempt edge cases', () => {
  it('handles a paper with questions but no attempts at all', () => {
    const sec = section({ id: 's1', name: 'Maths' });
    const { questions } = build([
      { index: 1, sectionId: 's1', attempt: false },
      { index: 2, sectionId: 's1', attempt: false },
    ]);
    const a = analysePaper({ paper: paper([sec]), questions, attempts: [] });

    expect(a.totals.attempted).toBe(0);
    expect(a.totals.accuracy).toBe(0);
    expect(a.totals.attemptRate).toBe(0);
    expect(a.totals.scorePct).toBe(0);
    expect(a.totals.time.samples).toBe(0);
    expect(a.totals.averageCorrectMs).toBe(0);
    expect(a.mistakes).toEqual([]);
    expect(a.unclassifiedMistakes).toBe(0);
    expect(a.sections[0].accuracy).toBe(0);
    expect(a.sections[0].medianMs).toBe(0);
  });

  it('handles a completely empty paper without dividing by zero', () => {
    const a = analysePaper({ paper: paper([]), questions: [], attempts: [] });
    expect(a.totals.questions).toBe(0);
    expect(a.totals.maxScore).toBe(0);
    expect(a.totals.scorePct).toBe(0);
    expect(a.sections).toEqual([]);
    expect(a.questions).toEqual([]);
  });

  it('reports elapsed time from `now` while the paper is still running', () => {
    const sec = section({ id: 's1', name: 'Physics' });
    const { questions, attempts } = build([{ index: 1, sectionId: 's1', status: 'correct', timeSec: 30 }]);
    const running = paper([sec], { status: 'in_progress', submittedAt: null });
    const a = analysePaper({
      paper: running, questions, attempts, now: new Date(START + 5 * 60 * 1000),
    });
    expect(a.totals.elapsedMs).toBe(5 * 60 * 1000);
  });

  it('reports null elapsed time for a paper that was never started', () => {
    const draft = paper([], { status: 'draft', startedAt: null, submittedAt: null });
    const a = analysePaper({ paper: draft, questions: [], attempts: [], now: new Date(START) });
    expect(a.totals.elapsedMs).toBeNull();
  });
});

describe('paperAnalytics — subject breakdown', () => {
  const physics = section({ id: 's1', name: 'Physics', trackerId: 'trk_phy' });
  const chem = section({ id: 's2', name: 'Chemistry', trackerId: 'trk_chem', marksPerQuestion: 3 });

  const fixture = build([
    { index: 1, sectionId: 's1', status: 'correct', timeSec: 40 },
    { index: 2, sectionId: 's1', status: 'incorrect', timeSec: 80, mistakeType: 'silly' },
    { index: 3, sectionId: 's1', status: 'skipped', timeSec: 5 },
    { index: 4, sectionId: 's2', status: 'correct', timeSec: 20, marks: 3 },
    { index: 5, sectionId: 's2', status: 'correct', timeSec: 60, marks: 3 },
    { index: 6, sectionId: 's2', attempt: false, marks: 3 },
  ]);

  const result = analysePaper({
    paper: paper([physics, chem]), questions: fixture.questions, attempts: fixture.attempts,
  });

  it('splits every metric per section and keeps section order', () => {
    expect(result.sections.map((s) => s.name)).toEqual(['Physics', 'Chemistry']);

    const [phy, che] = result.sections;
    expect(phy.questions).toBe(3);
    expect(phy.correct).toBe(1);
    expect(phy.incorrect).toBe(1);
    expect(phy.skipped).toBe(1);
    expect(phy.attempted).toBe(2);
    expect(phy.accuracy).toBeCloseTo(0.5, 6);
    expect(phy.score).toBe(3); // 4 - 1
    expect(phy.maxScore).toBe(12);
    expect(phy.totalTimeMs).toBe(125 * SEC);
    // timed: 40, 80, 5 -> median 40
    expect(phy.medianMs).toBe(40 * SEC);
    expect(phy.trackerId).toBe('trk_phy');

    expect(che.questions).toBe(3);
    expect(che.correct).toBe(2);
    expect(che.untouched).toBe(1);
    expect(che.accuracy).toBe(1);
    expect(che.attemptRate).toBeCloseTo(2 / 3, 6);
    expect(che.score).toBe(6);
    expect(che.maxScore).toBe(9);
    // timed: 20, 60 -> even count, median 40
    expect(che.medianMs).toBe(40 * SEC);
    expect(che.averageMs).toBe(40 * SEC);
  });

  it('section scores sum to the paper score', () => {
    const sum = result.sections.reduce((a, s) => a + s.score, 0);
    expect(sum).toBe(result.totals.score);
    const maxSum = result.sections.reduce((a, s) => a + s.maxScore, 0);
    expect(maxSum).toBe(result.totals.maxScore);
  });

  it('carries the section name onto every question row', () => {
    expect(result.questions.find((q) => q.index === 4)!.sectionName).toBe('Chemistry');
    expect(result.questions.find((q) => q.index === 1)!.sectionName).toBe('Physics');
  });
});

describe('paperAnalytics — mistake aggregation', () => {
  const sec = section({ id: 's1', name: 'Physics' });
  const fixture = build([
    { index: 1, sectionId: 's1', status: 'incorrect', timeSec: 30, mistakeType: 'calculation' },
    { index: 2, sectionId: 's1', status: 'incorrect', timeSec: 90, mistakeType: 'calculation' },
    { index: 3, sectionId: 's1', status: 'incorrect', timeSec: 45, mistakeType: 'silly' },
    { index: 4, sectionId: 's1', status: 'incorrect', timeSec: 60, mistakeType: null },
    { index: 5, sectionId: 's1', status: 'correct', timeSec: 20 },
  ]);
  const a = analysePaper({ paper: paper([sec]), questions: fixture.questions, attempts: fixture.attempts });

  it('counts, ranks and shares mistake types over classified mistakes only', () => {
    expect(a.mistakes.map((m) => m.type)).toEqual(['calculation', 'silly']);
    const calc = a.mistakes[0];
    expect(calc.count).toBe(2);
    expect(calc.label).toBe('Calculation');
    expect(calc.share).toBeCloseTo(2 / 3, 6);       // of 3 classified
    expect(calc.shareOfIncorrect).toBeCloseTo(0.5, 6); // of 4 incorrect
    expect(calc.averageTimeMs).toBe(60 * SEC);
    // 2 questions x (4 marks missed + 1 penalty)
    expect(calc.marksLost).toBe(10);
  });

  it('reports unclassified incorrect questions separately', () => {
    expect(a.unclassifiedMistakes).toBe(1);
  });

  it('mistake shares over classified mistakes sum to 1', () => {
    const total = a.mistakes.reduce((s, m) => s + m.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('omits mistake types with no occurrences', () => {
    expect(a.mistakes).toHaveLength(2);
    expect(MISTAKE_TYPES).toHaveLength(8);
  });
});

describe('paperAnalytics — pacing and question rows', () => {
  const sec = section({ id: 's1', name: 'Physics' });
  const fixture = build([
    { index: 1, sectionId: 's1', status: 'correct', timeSec: 30, expectedSeconds: 60 },
    { index: 2, sectionId: 's1', status: 'incorrect', timeSec: 150, expectedSeconds: 60, mistakeType: 'time_pressure', visits: 3 },
    { index: 3, sectionId: 's1', attempt: false, expectedSeconds: 60 },
  ]);
  const a = analysePaper({
    paper: paper([sec], { durationMinutes: 5 }), questions: fixture.questions, attempts: fixture.attempts,
  });

  it('computes overtime per question and only counts opened questions', () => {
    const rows = a.questions;
    expect(rows[0].overtimeMs).toBe(-30 * SEC);
    expect(rows[1].overtimeMs).toBe(90 * SEC);
    // never opened -> no overtime signal
    expect(rows[2].overtimeMs).toBe(0);
    expect(a.pacing.overtimeQuestions).toBe(1);
    expect(a.pacing.expectedMs).toBe(180 * SEC);
    expect(a.pacing.budgetRemainingMs).toBe(5 * 60 * SEC - 180 * SEC);
  });

  it('carries visits and mistake type onto the question row', () => {
    expect(a.questions[1].visits).toBe(3);
    expect(a.questions[1].mistakeType).toBe('time_pressure');
    expect(a.questions[2].status).toBe('unattempted');
    expect(a.questions[2].attemptId).toBeNull();
  });
});

describe('paperAnalytics — review table sorting', () => {
  const sec = section({ id: 's1', name: 'Physics' });
  const fixture = build([
    { index: 1, sectionId: 's1', status: 'correct', timeSec: 50 },
    { index: 2, sectionId: 's1', status: 'incorrect', timeSec: 120, mistakeType: 'silly', visits: 4 },
    { index: 3, sectionId: 's1', status: 'skipped', timeSec: 10 },
    { index: 4, sectionId: 's1', attempt: false },
    { index: 5, sectionId: 's1', status: 'incorrect', timeSec: 20, mistakeType: 'conceptual' },
  ]);
  const rows = analysePaper({ paper: paper([sec]), questions: fixture.questions, attempts: fixture.attempts }).questions;

  it('sorts by longest and shortest time, parking never-opened questions last', () => {
    expect(sortQuestions(rows, 'longest').map((r) => r.index)).toEqual([2, 1, 5, 3, 4]);
    expect(sortQuestions(rows, 'shortest').map((r) => r.index)).toEqual([3, 5, 1, 2, 4]);
  });

  it('sorts incorrect questions to the top', () => {
    const sorted = sortQuestions(rows, 'incorrect');
    expect(sorted.slice(0, 2).map((r) => r.index)).toEqual([2, 5]);
    expect(sorted[sorted.length - 1].index).toBe(1);
  });

  it('sorts skipped and untouched questions to the top', () => {
    expect(sortQuestions(rows, 'skipped').slice(0, 2).map((r) => r.index)).toEqual([3, 4]);
  });

  it('groups by mistake type in the canonical order', () => {
    // conceptual precedes silly in MISTAKE_TYPES
    expect(sortQuestions(rows, 'mistake').slice(0, 2).map((r) => r.index)).toEqual([5, 2]);
  });

  it('sorts by visits descending and never mutates the input array', () => {
    const before = rows.map((r) => r.index);
    expect(sortQuestions(rows, 'visits')[0].index).toBe(2);
    expect(rows.map((r) => r.index)).toEqual(before);
    expect(sortQuestions(rows, 'index').map((r) => r.index)).toEqual([1, 2, 3, 4, 5]);
  });
});
