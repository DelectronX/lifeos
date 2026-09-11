import type { Goal, GoalStatus, GoalType, Milestone, TrackerColor } from '@/types';
import type { DemoContext } from './world';

/**
 * Eight goals spanning every GoalType and every interesting progress state:
 * one nearly complete, one just started, one stalled, one already completed,
 * plus a paused one. Progress itself is NOT set here — it is recomputed from
 * the linked tasks/milestones/activities by goalService after the world is
 * written, so the numbers on screen always follow from real records.
 */

export interface GoalSeed {
  id: string;
  title: string;
  description: string;
  type: GoalType;
  trackerId: string;
  status: GoalStatus;
  /** Days from today. */
  startOffset: number;
  targetOffset: number | null;
  targetValue: number | null;
  unit?: string;
  weight: number;
  color: TrackerColor;
  milestones: { title: string; offset: number; weight: number; done: boolean }[];
}

export const DEMO_GOALS: GoalSeed[] = [
  {
    id: 'gol_demo_boards',
    title: 'Finish the full board syllabus',
    description: 'Every chapter across all five subjects covered at least once before the mocks.',
    type: 'completion',
    trackerId: 'trk_study',
    status: 'active',
    startOffset: -56,
    targetOffset: 21,
    targetValue: null,
    weight: 0.95,
    color: 'indigo',
    milestones: [
      { title: 'Mathematics: algebra + calculus', offset: -35, weight: 2, done: true },
      { title: 'Physics: mechanics + waves', offset: -21, weight: 2, done: true },
      { title: 'Chemistry: organic', offset: -7, weight: 2, done: true },
      { title: 'Biology: genetics', offset: 10, weight: 1, done: false },
      { title: 'Full revision pass', offset: 20, weight: 2, done: false },
    ],
  },
  {
    id: 'gol_demo_maths_hours',
    title: 'Log 60 hours of maths practice',
    description: 'Time on the clock, not time at the desk. Nearly there.',
    type: 'time',
    trackerId: 'trk_demo_maths',
    status: 'active',
    startOffset: -56,
    targetOffset: 14,
    targetValue: 60 * 60,
    unit: 'minutes',
    weight: 0.8,
    color: 'indigo',
    milestones: [],
  },
  {
    id: 'gol_demo_mocks',
    title: 'Score 80% on a full mock paper',
    description: 'Measured on the best submitted mock, marks out of the paper total.',
    type: 'milestone',
    trackerId: 'trk_study',
    status: 'active',
    startOffset: -49,
    targetOffset: 24,
    targetValue: null,
    weight: 0.9,
    color: 'sky',
    milestones: [
      { title: 'Sit a timed mock end to end', offset: -42, weight: 1, done: true },
      { title: 'Break 60%', offset: -28, weight: 1, done: true },
      { title: 'Break 70%', offset: -10, weight: 1, done: true },
      { title: 'Break 80%', offset: 21, weight: 2, done: false },
    ],
  },
  {
    id: 'gol_demo_strength',
    title: 'Train three times a week',
    description: 'Habit-driven: counted from real gym check-ins.',
    type: 'habit',
    trackerId: 'trk_demo_strength',
    status: 'active',
    startOffset: -56,
    targetOffset: null,
    targetValue: 24,
    unit: 'sessions',
    weight: 0.6,
    color: 'rose',
    milestones: [],
  },
  {
    id: 'gol_demo_guitar',
    title: 'Learn ten songs on guitar',
    description: 'Stalled since the mocks started — kept visible on purpose.',
    type: 'metric',
    trackerId: 'trk_demo_guitar',
    status: 'active',
    startOffset: -56,
    targetOffset: 45,
    targetValue: 10,
    unit: 'songs',
    weight: 0.35,
    color: 'violet',
    milestones: [
      { title: 'First three songs', offset: -40, weight: 1, done: true },
      { title: 'Barre chords clean', offset: 20, weight: 1, done: false },
    ],
  },
  {
    id: 'gol_demo_coding',
    title: 'Ship a personal project',
    description: 'Just started: scope agreed, first commits in.',
    type: 'completion',
    trackerId: 'trk_demo_coding',
    status: 'active',
    startOffset: -9,
    targetOffset: 40,
    targetValue: null,
    weight: 0.5,
    color: 'indigo',
    milestones: [
      { title: 'Decide the scope', offset: -7, weight: 1, done: true },
      { title: 'Working prototype', offset: 14, weight: 2, done: false },
      { title: 'Deployed and shared', offset: 38, weight: 2, done: false },
    ],
  },
  {
    id: 'gol_demo_reading',
    title: 'Read six books this term',
    description: 'Completed ahead of the deadline.',
    type: 'metric',
    trackerId: 'trk_demo_reading',
    status: 'completed',
    startOffset: -60,
    targetOffset: -3,
    targetValue: 6,
    unit: 'books',
    weight: 0.4,
    color: 'amber',
    milestones: [
      { title: 'Three books in', offset: -35, weight: 1, done: true },
      { title: 'Six books in', offset: -5, weight: 1, done: true },
    ],
  },
  {
    id: 'gol_demo_running',
    title: 'Run a sub-25 five kilometre',
    description: 'Paused while exam season runs. Deliberately not deleted.',
    type: 'metric',
    trackerId: 'trk_demo_running',
    status: 'paused',
    startOffset: -52,
    targetOffset: 60,
    targetValue: 40,
    unit: 'km',
    weight: 0.3,
    color: 'teal',
    milestones: [],
  },
];

export function seedGoals(ctx: DemoContext): void {
  for (const seed of DEMO_GOALS) {
    const createdAt = ctx.at(ctx.day(seed.startOffset), 9 * 60);
    const goal: Goal = {
      id: seed.id,
      createdAt,
      updatedAt: createdAt,
      title: seed.title,
      description: seed.description,
      type: seed.type,
      trackerId: seed.trackerId,
      status: seed.status,
      startDate: ctx.day(seed.startOffset),
      targetDate: seed.targetOffset === null ? null : ctx.day(seed.targetOffset),
      targetValue: seed.targetValue,
      unit: seed.unit,
      weight: seed.weight,
      progress: 0,
      progressComputedAt: null,
      completedAt: seed.status === 'completed' ? ctx.at(ctx.day(-3), 20 * 60) : null,
      color: seed.color,
    };
    ctx.world.goals.push(goal);

    seed.milestones.forEach((m, index) => {
      const milestone: Milestone = {
        id: `${seed.id}_ms${index + 1}`,
        createdAt,
        updatedAt: createdAt,
        goalId: seed.id,
        title: m.title,
        targetDate: ctx.day(m.offset),
        sortOrder: index,
        weight: m.weight,
        completedAt: m.done ? ctx.at(ctx.day(m.offset), 19 * 60) : null,
      };
      ctx.world.milestones.push(milestone);

      if (m.done) {
        ctx.world.activities.push({
          id: ctx.id('act'),
          createdAt: milestone.completedAt!,
          updatedAt: milestone.completedAt!,
          type: 'milestone_completed',
          at: milestone.completedAt!,
          date: ctx.day(m.offset),
          trackerId: goal.trackerId,
          taskId: null,
          goalId: goal.id,
          blockId: null,
          sessionId: null,
          paperId: null,
          revisionEntryId: null,
          habitId: null,
          resourceId: null,
          durationMs: 0,
          value: m.weight,
          unit: null,
          title: m.title,
          meta: { goalTitle: goal.title },
        });
      }
    });

    if (goal.completedAt) {
      ctx.world.activities.push({
        id: ctx.id('act'),
        createdAt: goal.completedAt,
        updatedAt: goal.completedAt,
        type: 'goal_completed',
        at: goal.completedAt,
        date: ctx.day(-3),
        trackerId: goal.trackerId,
        taskId: null,
        goalId: goal.id,
        blockId: null,
        sessionId: null,
        paperId: null,
        revisionEntryId: null,
        habitId: null,
        resourceId: null,
        durationMs: 0,
        value: null,
        unit: null,
        title: goal.title,
        meta: {},
      });
    }
  }
}
