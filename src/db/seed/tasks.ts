import { buildTask, type TaskDraft } from '@/services/taskService';
import { dateKeyToDate } from '@/lib/date';
import type { DateKey, Intensity, Task, TaskStatus, TaskType, TimeWindow } from '@/types';
import { HISTORY_DAYS, type DemoContext } from './world';
import {
  FITNESS_TRACKERS, PERSONAL_TRACKERS, SKILL_TRACKERS, STUDY_SUBJECTS,
} from './trackers';

/**
 * Task generation — the backbone of the demo dataset.
 *
 * Two things here are deliberate rather than decorative:
 *
 *  1. Every task is built with the real `buildTask` from taskService, so a
 *     seeded task is structurally identical to one the user created by hand,
 *     including its status history.
 *  2. `OVERRUN_BY_TRACKER` gives some categories a systematic estimate/actual
 *     bias. Maths, physics and programming genuinely run long; reading and
 *     English run slightly short. That is what gives the DurationPrediction
 *     engine a real pattern to find instead of noise around 1.0.
 */

/** actual / estimated bias per tracker. 1.0 = the user estimates well. */
const OVERRUN_BY_TRACKER: Record<string, number> = {
  trk_demo_maths: 1.46,
  trk_demo_physics: 1.34,
  trk_demo_chemistry: 1.08,
  trk_demo_biology: 1.02,
  trk_demo_english: 0.92,
  trk_demo_coding: 1.55,
  trk_demo_writing: 1.22,
  trk_demo_guitar: 1.05,
  trk_demo_strength: 1.0,
  trk_demo_running: 0.98,
  trk_demo_mobility: 1.0,
  trk_demo_reading: 0.88,
  trk_demo_journal: 0.95,
  trk_demo_family: 1.0,
};

interface TopicBank {
  trackerId: string;
  type: TaskType;
  intensity: Intensity;
  window: TimeWindow;
  minutes: [number, number];
  titles: string[];
  goalId?: string;
}

const BANKS: TopicBank[] = [
  {
    trackerId: 'trk_demo_maths', type: 'practice', intensity: 'high', window: 'morning',
    minutes: [40, 75], goalId: 'gol_demo_boards',
    titles: [
      'Integration by parts problem set', 'Definite integrals — mixed drill',
      'Matrices and determinants', 'Probability: conditional problems',
      'Vectors — 3D geometry set', 'Differential equations practice',
      'Complex numbers revision drill', 'Permutations and combinations',
      'Continuity and differentiability', 'Application of derivatives',
    ],
  },
  {
    trackerId: 'trk_demo_maths', type: 'practice', intensity: 'medium', window: 'afternoon',
    minutes: [30, 60], goalId: 'gol_demo_maths_hours',
    titles: [
      'Timed maths drill — 45 minutes', 'Past-paper maths section',
      'Mixed revision: algebra + calculus', 'Speed practice: objective questions',
      'Error log review — maths',
    ],
  },
  {
    trackerId: 'trk_demo_physics', type: 'study', intensity: 'high', window: 'morning',
    minutes: [35, 70], goalId: 'gol_demo_boards',
    titles: [
      'Rotational motion — theory pass', 'Electrostatics numericals',
      'Current electricity worked examples', 'Ray optics derivations',
      'Wave optics — interference', 'Modern physics: photoelectric effect',
      'Thermodynamics problem set', 'Magnetism and matter notes',
      'Alternating current circuits', 'Semiconductor basics',
    ],
  },
  {
    trackerId: 'trk_demo_chemistry', type: 'study', intensity: 'medium', window: 'afternoon',
    minutes: [30, 60], goalId: 'gol_demo_boards',
    titles: [
      'Organic: named reactions recap', 'Aldehydes and ketones mechanisms',
      'Electrochemistry numericals', 'Chemical kinetics problems',
      'Coordination compounds', 'p-block element trends',
      'Solutions and colligative properties', 'Biomolecules summary sheet',
      'Haloalkanes reaction map', 'Surface chemistry notes',
    ],
  },
  {
    trackerId: 'trk_demo_biology', type: 'reading', intensity: 'medium', window: 'evening',
    minutes: [25, 55], goalId: 'gol_demo_boards',
    titles: [
      'Genetics: Mendelian inheritance', 'Molecular basis of inheritance',
      'Human reproduction diagrams', 'Evolution — evidence chapter',
      'Ecology: population interactions', 'Biotechnology principles',
      'Plant physiology recap', 'Human health and disease',
    ],
  },
  {
    trackerId: 'trk_demo_english', type: 'writing', intensity: 'low', window: 'evening',
    minutes: [20, 45], goalId: 'gol_demo_boards',
    titles: [
      'Comprehension practice passage', 'Formal letter format drill',
      'Essay: technology and society', 'Poetry analysis — unseen',
      'Report writing practice', 'Grammar: error correction set',
    ],
  },
  {
    trackerId: 'trk_demo_strength', type: 'workout', intensity: 'high', window: 'evening',
    minutes: [45, 70], goalId: 'gol_demo_strength',
    titles: [
      'Push day — bench, overhead, dips', 'Pull day — rows and chins',
      'Leg day — squats and lunges', 'Full body circuit',
      'Upper body accessories', 'Deadlift session',
    ],
  },
  {
    trackerId: 'trk_demo_running', type: 'workout', intensity: 'medium', window: 'morning',
    minutes: [25, 50], goalId: 'gol_demo_running',
    titles: ['Easy 5k', 'Interval session — 8x400', 'Tempo run', 'Long slow run', 'Recovery jog'],
  },
  {
    trackerId: 'trk_demo_mobility', type: 'workout', intensity: 'low', window: 'night',
    minutes: [15, 25],
    titles: ['Hip mobility routine', 'Shoulder mobility', 'Full stretch session'],
  },
  {
    trackerId: 'trk_demo_guitar', type: 'practice', intensity: 'low', window: 'evening',
    minutes: [20, 45], goalId: 'gol_demo_guitar',
    titles: [
      'Chord transitions drill', 'Learn verse of a new song',
      'Barre chord conditioning', 'Fingerpicking pattern practice',
      'Scale practice with metronome',
    ],
  },
  {
    trackerId: 'trk_demo_coding', type: 'project', intensity: 'high', window: 'evening',
    minutes: [45, 90], goalId: 'gol_demo_coding',
    titles: [
      'Sketch the data model', 'Build the list view',
      'Wire up local persistence', 'Refactor the state layer',
      'Write tests for the parser', 'Fix the layout on mobile',
      'Set up the build pipeline',
    ],
  },
  {
    trackerId: 'trk_demo_writing', type: 'writing', intensity: 'medium', window: 'evening',
    minutes: [25, 50],
    titles: ['Draft a blog post', 'Edit last week\u2019s draft', 'Outline a short story'],
  },
  {
    trackerId: 'trk_demo_reading', type: 'reading', intensity: 'low', window: 'night',
    minutes: [25, 50], goalId: 'gol_demo_reading',
    titles: ['Read a chapter before bed', 'Finish the current book', 'Start the next book'],
  },
  {
    trackerId: 'trk_demo_journal', type: 'other', intensity: 'low', window: 'night',
    minutes: [10, 20],
    titles: ['Evening journal entry', 'Weekly reflection write-up'],
  },
  {
    trackerId: 'trk_demo_family', type: 'other', intensity: 'low', window: 'evening',
    minutes: [45, 120],
    titles: ['Call home', 'Board game evening', 'Help with the weekly shop', 'Cook dinner together'],
  },
  {
    trackerId: 'trk_personal', type: 'chore', intensity: 'low', window: 'afternoon',
    minutes: [15, 40],
    titles: ['Tidy the desk', 'Laundry', 'Reply to pending messages', 'Plan the week ahead'],
  },
  {
    trackerId: 'trk_personal', type: 'admin', intensity: 'low', window: 'afternoon',
    minutes: [15, 30],
    titles: ['Renew the library card', 'Book the dentist', 'Sort out exam form', 'Update the budget sheet'],
  },
];

const STUDY_BANKS = BANKS.filter((b) => (STUDY_SUBJECTS as readonly string[]).includes(b.trackerId));
const FITNESS_BANKS = BANKS.filter((b) => (FITNESS_TRACKERS as readonly string[]).includes(b.trackerId));
const SKILL_BANKS = BANKS.filter((b) => (SKILL_TRACKERS as readonly string[]).includes(b.trackerId));
const PERSONAL_BANKS = BANKS.filter(
  (b) => (PERSONAL_TRACKERS as readonly string[]).includes(b.trackerId) || b.trackerId === 'trk_personal',
);

/** Returns the realistic actual duration for an estimate in this category. */
export function actualMinutesFor(ctx: DemoContext, trackerId: string, estimated: number): number {
  const bias = OVERRUN_BY_TRACKER[trackerId] ?? 1;
  const ratio = ctx.rng.gaussian(bias, 0.16, Math.max(0.4, bias - 0.45), bias + 0.6);
  return Math.max(5, Math.round((estimated * ratio) / 5) * 5);
}

function pickBank(ctx: DemoContext, day: DateKey, slot: number): TopicBank {
  const weekend = [0, 6].includes(dateKeyToDate(day).getDay());
  if (weekend) {
    return ctx.rng.weighted([
      [ctx.rng.pick(STUDY_BANKS), 3],
      [ctx.rng.pick(SKILL_BANKS), 3],
      [ctx.rng.pick(FITNESS_BANKS), 2],
      [ctx.rng.pick(PERSONAL_BANKS), 3],
    ]);
  }
  // Weekdays lead with study; later slots drift to skills/fitness/personal.
  if (slot < 2) return ctx.rng.pick(STUDY_BANKS);
  return ctx.rng.weighted([
    [ctx.rng.pick(STUDY_BANKS), 4],
    [ctx.rng.pick(FITNESS_BANKS), 2],
    [ctx.rng.pick(SKILL_BANKS), 2],
    [ctx.rng.pick(PERSONAL_BANKS), 2],
  ]);
}

function draftFrom(ctx: DemoContext, bank: TopicBank, dueDate: DateKey | null): TaskDraft {
  const estimated = Math.round(ctx.rng.int(bank.minutes[0], bank.minutes[1]) / 5) * 5;
  return {
    title: ctx.rng.pick(bank.titles),
    trackerId: bank.trackerId,
    goalId: bank.goalId ?? null,
    type: bank.type,
    basePriority: ctx.rng.weighted<1 | 2 | 3 | 4 | 5>([[1, 1], [2, 2], [3, 5], [4, 3], [5, 1]]),
    dueDate,
    deadlineHard: ctx.rng.chance(0.18),
    estimatedMinutes: estimated,
    preferredWindow: bank.window,
    intensity: bank.intensity,
    tags: ctx.rng.chance(0.3) ? [ctx.rng.pick(['focus', 'exam', 'routine', 'backlog'])] : [],
    topic: bank.trackerId.replace('trk_demo_', ''),
    splittable: estimated >= 45,
    minSessionMinutes: 20,
    maxSessionMinutes: 120,
  };
}

/**
 * `buildTask` is the real constructor, which is the point — but it mints ids
 * with `newId`, which is time + `Math.random`. Re-stamping the id from the
 * context's counter is what makes the dataset byte-identical across runs.
 */
function build(ctx: DemoContext, draft: TaskDraft, createdAt: number): Task {
  const task = buildTask(draft, createdAt);
  task.id = ctx.id('tsk');
  return task;
}

/** Attaches a milestone when the task's goal has an open one on that date. */
function milestoneFor(ctx: DemoContext, goalId: string | null, day: DateKey): string | null {
  if (!goalId) return null;
  const candidates = ctx.world.milestones
    .filter((m) => m.goalId === goalId && (m.targetDate ?? '') >= day)
    .sort((a, b) => (a.targetDate ?? '').localeCompare(b.targetDate ?? ''));
  return candidates[0]?.id ?? null;
}

function applyStatus(
  ctx: DemoContext, task: Task, status: TaskStatus, day: DateKey, hour: number,
): void {
  const at = ctx.at(day, hour * 60 + ctx.rng.int(0, 55));
  task.status = status;
  task.updatedAt = at;
  task.statusHistory = [
    { from: null, to: 'inbox', at: task.createdAt },
    { from: 'inbox', to: 'planned', at: task.createdAt + 600_000 },
  ];
  if (status !== 'planned') {
    task.statusHistory.push({
      from: 'planned',
      to: status,
      at,
      reason: status === 'skipped'
        ? 'Ran out of time'
        : status === 'cancelled'
          ? 'No longer relevant'
          : status === 'rescheduled'
            ? 'Moved to a later day'
            : undefined,
    });
  }
  if (status === 'completed') {
    task.completedAt = at;
    task.actualMinutes = actualMinutesFor(ctx, task.trackerId, task.estimatedMinutes);
  }
  if (status === 'rescheduled') task.rescheduleCount = ctx.rng.int(1, 2);
  if (status === 'in_progress') {
    task.actualMinutes = Math.round(task.estimatedMinutes * ctx.rng.float(0.2, 0.6));
  }
}

export function seedTasks(ctx: DemoContext): void {
  const tasks: Task[] = [];

  /* --- past days: mostly done, with honest failures mixed in ----------- */
  for (const day of ctx.pastDays) {
    const weekend = [0, 6].includes(dateKeyToDate(day).getDay());
    const count = weekend ? ctx.rng.int(2, 4) : ctx.rng.int(3, 6);
    for (let slot = 0; slot < count; slot++) {
      const bank = pickBank(ctx, day, slot);
      const createdAt = Math.max(
        ctx.at(ctx.day(-HISTORY_DAYS), 7 * 60),
        ctx.at(day, 7 * 60) - ctx.rng.int(1, 5) * 86_400_000,
      );
      const task = build(ctx, { ...draftFrom(ctx, bank, day), status: 'planned' }, createdAt);
      task.milestoneId = milestoneFor(ctx, task.goalId, day);
      task.sortOrder = createdAt + slot;

      const status = ctx.rng.weighted<TaskStatus>([
        ['completed', 78],
        ['skipped', 8],
        ['rescheduled', 7],
        ['cancelled', 4],
        // A small residue of past work that was never closed out — this is
        // what the overdue list and auto-reschedule feed on. Kept low on
        // purpose: a demo drowning in 60 overdue items reads as broken.
        ['planned', 3],
      ]);
      applyStatus(ctx, task, status, day, bank.window === 'morning' ? 9 : bank.window === 'afternoon' ? 14 : 19);
      tasks.push(task);
    }
  }

  /* --- today: a live mix so Home is never empty ------------------------ */
  for (let slot = 0; slot < 6; slot++) {
    const bank = pickBank(ctx, ctx.today, slot);
    const task = build(
      ctx,
      { ...draftFrom(ctx, bank, ctx.today), status: 'planned' },
      ctx.at(ctx.day(-ctx.rng.int(1, 4)), 8 * 60),
    );
    task.milestoneId = milestoneFor(ctx, task.goalId, ctx.today);
    if (slot === 0) applyStatus(ctx, task, 'completed', ctx.today, 8);
    else if (slot === 1) applyStatus(ctx, task, 'completed', ctx.today, 10);
    else if (slot === 2) applyStatus(ctx, task, 'in_progress', ctx.today, 12);
    tasks.push(task);
  }

  /* --- future days: planned work ahead --------------------------------- */
  for (const day of ctx.futureDays.filter((d) => d > ctx.today)) {
    const weekend = [0, 6].includes(dateKeyToDate(day).getDay());
    const count = weekend ? ctx.rng.int(1, 3) : ctx.rng.int(2, 4);
    for (let slot = 0; slot < count; slot++) {
      const bank = pickBank(ctx, day, slot);
      const task = build(
        ctx,
        { ...draftFrom(ctx, bank, day), status: 'planned' },
        ctx.at(ctx.day(-ctx.rng.int(0, 6)), 9 * 60),
      );
      task.milestoneId = milestoneFor(ctx, task.goalId, day);
      task.statusHistory = [
        { from: null, to: 'inbox', at: task.createdAt },
        { from: 'inbox', to: 'planned', at: task.createdAt + 600_000 },
      ];
      tasks.push(task);
    }
  }

  /* --- overdue stragglers: the fuel for auto-reschedule ---------------- */
  for (let i = 0; i < 5; i++) {
    const bank = ctx.rng.pick(STUDY_BANKS);
    const dueOffset = -ctx.rng.int(2, 9);
    const task = build(
      ctx,
      { ...draftFrom(ctx, bank, ctx.day(dueOffset)), status: 'planned', basePriority: 4 },
      ctx.at(ctx.day(dueOffset - 3), 9 * 60),
    );
    task.title = `${task.title} (carried over)`;
    task.rescheduleCount = ctx.rng.int(1, 2);
    task.statusHistory = [
      { from: null, to: 'inbox', at: task.createdAt },
      { from: 'inbox', to: 'planned', at: task.createdAt + 600_000 },
    ];
    tasks.push(task);
  }

  /* --- inbox: unsorted capture ----------------------------------------- */
  const inboxTitles = [
    'Ask the teacher about question 14', 'Find a better organic chemistry reference',
    'Look into the summer coding course', 'Replace guitar strings',
    'Compare running shoes', 'Sort the physics formula sheet',
    'Back up the notes folder', 'Book a haircut',
    'Draft the scholarship application', 'Fix the wobbly desk',
    'Plan the revision timetable for finals', 'Try the new study playlist',
  ];
  for (const title of inboxTitles) {
    const bank = ctx.rng.pick(BANKS);
    const task = build(
      ctx,
      {
        title,
        trackerId: bank.trackerId,
        type: bank.type,
        status: 'inbox',
        estimatedMinutes: ctx.rng.int(3, 12) * 5,
        intensity: 'low',
        preferredWindow: 'any',
      },
      ctx.at(ctx.day(-ctx.rng.int(0, 18)), ctx.rng.int(9, 21) * 60),
    );
    tasks.push(task);
  }

  ctx.world.tasks.push(...tasks);
}
