import { REWARD_PRESETS } from '@/config/rewards';
import type { CustomReward, Resource } from '@/types';
import type { DemoContext } from './world';

/**
 * Resources and custom rewards.
 *
 * Resources: one text note and one external URL, both attached to real tasks
 * via the reverse-lookup arrays the app maintains, plus a couple of tracked
 * study references with progress so the resource library is not a stub.
 *
 * Rewards: built from the shipped presets, so their condition ASTs are exactly
 * the ones the reward builder produces. Earnings are NOT seeded — the real
 * `evaluateRewards` runs after the world is written and records whichever of
 * them the seeded history genuinely satisfies.
 */

export function seedResources(ctx: DemoContext): void {
  const createdAt = ctx.at(ctx.day(-45), 11 * 60);

  const studyTasks = ctx.world.tasks.filter((t) => t.trackerId === 'trk_demo_physics').slice(0, 3);
  const mathsTasks = ctx.world.tasks.filter((t) => t.trackerId === 'trk_demo_maths').slice(0, 4);
  const codingTasks = ctx.world.tasks.filter((t) => t.trackerId === 'trk_demo_coding').slice(0, 2);

  const resources: Resource[] = [
    {
      id: 'res_demo_note',
      createdAt,
      updatedAt: createdAt,
      title: 'Physics formula sheet',
      type: 'note',
      trackerId: 'trk_demo_physics',
      attachmentId: null,
      unit: 'sections',
      currentUnit: 6,
      totalUnits: 9,
      tags: ['exam', 'reference'],
      archived: false,
      notes: [
        'Kinematics: v = u + at, s = ut + ½at², v² = u² + 2as',
        'Rotational: τ = Iα, L = Iω, KE = ½Iω²',
        'Electrostatics: F = kq₁q₂/r², E = kq/r², V = kq/r',
        'Circuits: V = IR, P = VI, series R adds, parallel 1/R adds',
        'Optics: 1/v − 1/u = 1/f, magnification m = v/u',
        'Modern: E = hf, KEmax = hf − φ',
        '',
        'Still to add: thermodynamics, AC circuits, semiconductors.',
      ].join('\n'),
      taskIds: studyTasks.map((t) => t.id),
      blockIds: [],
      goalIds: ['gol_demo_boards'],
    },
    {
      id: 'res_demo_link',
      createdAt,
      updatedAt: createdAt,
      title: 'Khan Academy — Integral calculus',
      type: 'link',
      trackerId: 'trk_demo_maths',
      url: 'https://www.khanacademy.org/math/integral-calculus',
      attachmentId: null,
      unit: 'lessons',
      currentUnit: 14,
      totalUnits: 22,
      tags: ['video', 'maths'],
      archived: false,
      notes: 'Working through the integration unit alongside the problem sets.',
      taskIds: mathsTasks.map((t) => t.id),
      blockIds: [],
      goalIds: ['gol_demo_maths_hours'],
    },
    {
      id: 'res_demo_book',
      createdAt: ctx.at(ctx.day(-58), 10 * 60),
      updatedAt: ctx.at(ctx.day(-4), 22 * 60),
      title: 'Organic Chemistry — Clayden',
      type: 'book',
      trackerId: 'trk_demo_chemistry',
      attachmentId: null,
      unit: 'pages',
      currentUnit: 312,
      totalUnits: 1200,
      tags: ['textbook'],
      archived: false,
      taskIds: [],
      blockIds: [],
      goalIds: [],
    },
    {
      id: 'res_demo_course',
      createdAt: ctx.at(ctx.day(-20), 18 * 60),
      updatedAt: ctx.at(ctx.day(-2), 21 * 60),
      title: 'Build a React app from scratch',
      type: 'course',
      trackerId: 'trk_demo_coding',
      url: 'https://example.com/courses/react-from-scratch',
      attachmentId: null,
      unit: 'lectures',
      currentUnit: 7,
      totalUnits: 24,
      tags: ['project'],
      archived: false,
      taskIds: codingTasks.map((t) => t.id),
      blockIds: [],
      goalIds: ['gol_demo_coding'],
    },
  ];

  // Keep the reverse links honest in both directions.
  const byTask = new Map<string, string[]>();
  for (const resource of resources) {
    for (const taskId of resource.taskIds ?? []) {
      byTask.set(taskId, [...(byTask.get(taskId) ?? []), resource.id]);
    }
  }
  for (const task of ctx.world.tasks) {
    const ids = byTask.get(task.id);
    if (ids) task.resourceIds = ids;
  }

  ctx.world.resources.push(...resources);

  for (const resource of resources) {
    if (resource.currentUnit <= 0) continue;
    const at = resource.updatedAt;
    ctx.world.activities.push({
      id: ctx.id('act'),
      createdAt: at,
      updatedAt: at,
      type: 'resource_progress',
      at,
      date: ctx.day(Math.max(-45, Math.round((at - ctx.todayStart) / 86_400_000))),
      trackerId: resource.trackerId,
      taskId: null,
      goalId: null,
      blockId: null,
      sessionId: null,
      paperId: null,
      revisionEntryId: null,
      habitId: null,
      resourceId: resource.id,
      durationMs: 0,
      value: resource.currentUnit,
      unit: resource.unit,
      title: resource.title,
      meta: { totalUnits: resource.totalUnits },
    });
  }
}

export function seedRewards(ctx: DemoContext): void {
  const createdAt = ctx.at(ctx.day(-38), 20 * 60);
  const wanted: { preset: string; treat: string }[] = [
    { preset: 'weekly_study', treat: 'Cinema trip on Sunday' },
    { preset: 'balanced_week', treat: 'New guitar strings' },
    { preset: 'clear_day', treat: 'An hour of guilt-free gaming' },
  ];

  let sortOrder = 0;
  for (const { preset, treat } of wanted) {
    const definition = REWARD_PRESETS.find((p) => p.key === preset);
    if (!definition) continue;
    let conditionCounter = 0;
    const reward: CustomReward = {
      id: `rwd_demo_${preset}`,
      createdAt,
      updatedAt: createdAt,
      name: definition.name,
      description: definition.description,
      xpValue: definition.xpValue,
      treat,
      condition: definition.build(() => `cnd_demo_${preset}_${conditionCounter++}`),
      repeat: definition.repeat,
      archived: false,
      sortOrder: sortOrder++,
    };
    ctx.world.rewards.push(reward);
  }
}
