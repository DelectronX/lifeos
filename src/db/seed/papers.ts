import { toDateKey } from '@/lib/date';
import type {
  MistakeType, Paper, PaperSection, Question, QuestionAttempt, QuestionStatus, TimerSession,
} from '@/types';
import type { DemoContext } from './world';

/**
 * Five completed mock papers spread across the history, each with real
 * per-question timings, statuses and mistake classifications.
 *
 * The accuracy target climbs from 0.52 to 0.81 across the five attempts, and
 * the mistake mix shifts with it — early papers are full of `unknown_concept`,
 * later ones are mostly `silly` and `time_pressure`. That gives Paper review,
 * the Study analytics section and the "papers improved" achievement a genuine
 * improvement curve rather than five random draws.
 */

interface PaperSeed {
  id: string;
  title: string;
  offset: number;
  durationMinutes: number;
  accuracy: number;
  skipRate: number;
  sections: { name: string; trackerId: string; count: number; marks: number; negative: number }[];
}

const PAPERS: PaperSeed[] = [
  {
    id: 'pap_demo_1', title: 'Full mock 1 — all subjects', offset: -56, durationMinutes: 180,
    accuracy: 0.52, skipRate: 0.14,
    sections: [
      { name: 'Physics', trackerId: 'trk_demo_physics', count: 15, marks: 4, negative: 1 },
      { name: 'Chemistry', trackerId: 'trk_demo_chemistry', count: 15, marks: 4, negative: 1 },
      { name: 'Mathematics', trackerId: 'trk_demo_maths', count: 15, marks: 4, negative: 1 },
    ],
  },
  {
    id: 'pap_demo_2', title: 'Physics unit test', offset: -42, durationMinutes: 60,
    accuracy: 0.61, skipRate: 0.10,
    sections: [{ name: 'Physics', trackerId: 'trk_demo_physics', count: 20, marks: 3, negative: 1 }],
  },
  {
    id: 'pap_demo_3', title: 'Full mock 2 — all subjects', offset: -28, durationMinutes: 180,
    accuracy: 0.68, skipRate: 0.08,
    sections: [
      { name: 'Physics', trackerId: 'trk_demo_physics', count: 15, marks: 4, negative: 1 },
      { name: 'Chemistry', trackerId: 'trk_demo_chemistry', count: 15, marks: 4, negative: 1 },
      { name: 'Mathematics', trackerId: 'trk_demo_maths', count: 15, marks: 4, negative: 1 },
    ],
  },
  {
    id: 'pap_demo_4', title: 'Chemistry organic drill', offset: -17, durationMinutes: 45,
    accuracy: 0.74, skipRate: 0.05,
    sections: [{ name: 'Organic chemistry', trackerId: 'trk_demo_chemistry', count: 16, marks: 3, negative: 1 }],
  },
  {
    id: 'pap_demo_5', title: 'Full mock 3 — all subjects', offset: -6, durationMinutes: 180,
    accuracy: 0.81, skipRate: 0.04,
    sections: [
      { name: 'Physics', trackerId: 'trk_demo_physics', count: 15, marks: 4, negative: 1 },
      { name: 'Chemistry', trackerId: 'trk_demo_chemistry', count: 15, marks: 4, negative: 1 },
      { name: 'Mathematics', trackerId: 'trk_demo_maths', count: 15, marks: 4, negative: 1 },
      { name: 'Biology', trackerId: 'trk_demo_biology', count: 10, marks: 4, negative: 1 },
    ],
  },
];

/** Mistake mix shifts from "did not know it" to "knew it, rushed it". */
function mistakeFor(ctx: DemoContext, accuracy: number): MistakeType {
  if (accuracy < 0.6) {
    return ctx.rng.weighted<MistakeType>([
      ['unknown_concept', 5], ['conceptual', 4], ['calculation', 2], ['guess', 2], ['misread', 1],
    ]);
  }
  if (accuracy < 0.75) {
    return ctx.rng.weighted<MistakeType>([
      ['conceptual', 3], ['calculation', 4], ['silly', 3], ['time_pressure', 2], ['misread', 2],
    ]);
  }
  return ctx.rng.weighted<MistakeType>([
    ['silly', 4], ['time_pressure', 4], ['calculation', 2], ['misread', 2], ['conceptual', 1],
  ]);
}

export function seedPapers(ctx: DemoContext): void {
  for (const seed of PAPERS) {
    const day = ctx.day(seed.offset);
    const startedAt = ctx.at(day, 9 * 60 + 30);
    const createdAt = startedAt - 2 * 86_400_000;

    const sections: PaperSection[] = seed.sections.map((s) => ({
      id: ctx.id('sec'),
      name: s.name,
      trackerId: s.trackerId,
      questionCount: s.count,
      marksPerQuestion: s.marks,
      negativeMarks: s.negative,
    }));

    const totalQuestions = sections.reduce((sum, s) => sum + s.questionCount, 0);
    const expectedSeconds = Math.max(30, Math.round((seed.durationMinutes * 60) / totalQuestions));

    const questions: Question[] = [];
    const attempts: QuestionAttempt[] = [];
    let index = 1;
    let score = 0;
    let maxScore = 0;
    let totalMs = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let skippedCount = 0;

    for (const section of sections) {
      for (let i = 0; i < section.questionCount; i++) {
        const question: Question = {
          id: ctx.id('qst'),
          createdAt,
          updatedAt: createdAt,
          paperId: seed.id,
          sectionId: section.id,
          index: index++,
          trackerId: section.trackerId,
          topic: section.name,
          marks: section.marksPerQuestion,
          negativeMarks: section.negativeMarks,
          expectedSeconds,
        };
        questions.push(question);
        maxScore += question.marks;

        const skipped = ctx.rng.chance(seed.skipRate);
        const correct = !skipped && ctx.rng.chance(seed.accuracy / (1 - seed.skipRate));
        const status: QuestionStatus = skipped ? 'skipped' : correct ? 'correct' : 'incorrect';

        // Correct answers are quicker; wrong ones burn time. Skips are glances.
        const factor = skipped
          ? ctx.rng.float(0.1, 0.35)
          : correct
            ? ctx.rng.float(0.55, 1.05)
            : ctx.rng.float(1.1, 2.1);
        const timeSpentMs = Math.round(expectedSeconds * 1000 * factor);
        totalMs += timeSpentMs;

        if (status === 'correct') { score += question.marks; correctCount++; }
        if (status === 'incorrect') { score -= question.negativeMarks; incorrectCount++; }
        if (status === 'skipped') skippedCount++;

        attempts.push({
          id: ctx.id('att'),
          createdAt: startedAt,
          updatedAt: startedAt + timeSpentMs,
          questionId: question.id,
          paperId: seed.id,
          sectionId: section.id,
          trackerId: section.trackerId,
          status,
          attemptedAt: startedAt + timeSpentMs,
          timeSpentMs,
          visits: ctx.rng.weighted<number>([[1, 6], [2, 3], [3, 1]]),
          mistakeType: status === 'incorrect' ? mistakeFor(ctx, seed.accuracy) : null,
          confidence: status === 'skipped'
            ? 1
            : ctx.rng.weighted<1 | 2 | 3 | 4 | 5>(
              correct ? [[3, 2], [4, 4], [5, 3]] : [[1, 3], [2, 4], [3, 2]],
            ),
          notes: status === 'incorrect' && ctx.rng.chance(0.2)
            ? 'Revisit this — re-derive the formula from scratch.'
            : undefined,
        });
      }
    }

    const submittedAt = startedAt + Math.max(totalMs, seed.durationMinutes * 60_000 * 0.75);

    const paper: Paper = {
      id: seed.id,
      createdAt,
      updatedAt: submittedAt,
      title: seed.title,
      sections,
      durationMinutes: seed.durationMinutes,
      timed: true,
      status: 'reviewed',
      startedAt,
      submittedAt,
      date: day,
      score,
      maxScore,
      notes: 'Reviewed with mistakes classified.',
    };

    const session: TimerSession = {
      id: ctx.id('ses'),
      createdAt: startedAt,
      updatedAt: submittedAt,
      mode: 'paper',
      taskId: null,
      blockId: null,
      goalId: null,
      trackerId: sections[0]!.trackerId,
      paperId: paper.id,
      resourceId: null,
      startedAt,
      endedAt: submittedAt,
      workMs: submittedAt - startedAt,
      breakMs: 0,
      plannedMs: seed.durationMinutes * 60_000,
      segments: [{ start: startedAt, end: submittedAt, phase: 'work' }],
      pomodoroCount: 0,
      interruptions: 0,
      completed: true,
      date: toDateKey(startedAt),
    };

    const attemptedCount = correctCount + incorrectCount;
    ctx.world.activities.push({
      id: ctx.id('act'),
      createdAt: submittedAt,
      updatedAt: submittedAt,
      type: 'paper_submitted',
      at: submittedAt,
      date: day,
      trackerId: session.trackerId,
      taskId: null,
      goalId: 'gol_demo_mocks',
      blockId: null,
      sessionId: session.id,
      paperId: paper.id,
      revisionEntryId: null,
      habitId: null,
      resourceId: null,
      durationMs: session.workMs,
      value: score,
      unit: 'marks',
      title: paper.title,
      meta: {
        maxScore,
        accuracy: attemptedCount > 0 ? correctCount / attemptedCount : 0,
        attempted: attemptedCount,
        correct: correctCount,
        incorrect: incorrectCount,
        skipped: skippedCount,
        questions: totalQuestions,
      },
    });

    ctx.world.papers.push(paper);
    ctx.world.questions.push(...questions);
    ctx.world.attempts.push(...attempts);
    ctx.world.sessions.push(session);
  }
}
