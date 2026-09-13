import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { createDefaultSettings } from '@/db/seed';
import { newId } from '@/lib/id';
import { minuteOfDay } from '@/lib/date';
import { applyAutoPlan, previewAutoPlan } from '@/services/planService';
import { createScheduleRule } from '@/services/scheduleRuleService';
import { buildTask } from '@/services/taskService';
import type { Tracker } from '@/types';

/**
 * End-to-end (real Dexie) coverage for:
 *  1. the HARD subject-window guarantee actually reaching `previewAutoPlan`
 *     via the real ScheduleRule persistence path, and
 *  2. "Regenerate Plan" replacing its own previous auto-planned blocks
 *     rather than stacking duplicates on repeated runs.
 */
describe('planService — Auto Plan rules integration', () => {
  const NOW = new Date('2026-03-02T06:00:00'); // a Monday

  function makeTracker(id: string, name: string): Tracker {
    const now = Date.now();
    return {
      id, createdAt: now, updatedAt: now, name, pillar: 'study', parentId: null,
      color: 'indigo', system: false, defaultProtected: false, archived: false, sortOrder: 0,
    };
  }

  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) {
      await db.table(name).clear();
    }
    await db.scheduleRules.clear();
    await db.settings.put(createDefaultSettings());
    await db.trackers.bulkAdd([makeTracker('trk_maths', 'Mathematics'), makeTracker('trk_fitness', 'Fitness')]);
  });

  it('previewAutoPlan never places a hard-windowed subject outside its rule', async () => {
    await createScheduleRule({
      trackerId: 'trk_maths', days: [1, 2, 3, 4, 5], startMinute: 16 * 60, endMinute: 18 * 60,
    });
    await db.tasks.add(buildTask({
      title: 'Calculus revision', trackerId: 'trk_maths', estimatedMinutes: 600,
    }, NOW.getTime()));
    // splittable/session bounds are not on TaskDraft; patch after building.
    const [task] = await db.tasks.toArray();
    await db.tasks.update(task!.id, { splittable: true, minSessionMinutes: 30, maxSessionMinutes: 60 });

    const preview = await previewAutoPlan({ days: 7, now: NOW });
    expect(preview.result.proposals.length).toBeGreaterThan(0);
    for (const p of preview.result.proposals) {
      const day = new Date(p.start).getDay();
      expect([1, 2, 3, 4, 5]).toContain(day);
      expect(minuteOfDay(p.start)).toBeGreaterThanOrEqual(16 * 60);
      expect(minuteOfDay(p.end - 1)).toBeLessThan(18 * 60);
    }
  });

  it('regenerating a plan twice does not duplicate blocks', async () => {
    await db.tasks.add(buildTask({
      title: 'Read chapter 4', trackerId: 'trk_fitness', estimatedMinutes: 60,
    }, NOW.getTime()));

    const first = await previewAutoPlan({ days: 1, now: NOW });
    expect(first.result.proposals).toHaveLength(1);
    const applied1 = await applyAutoPlan(first);
    expect(applied1.created).toBe(1);
    expect(await db.blocks.count()).toBe(1);

    // Regenerate: should replace the one scheduler-origin block, not add a second.
    const second = await previewAutoPlan({ days: 1, now: NOW, regenerate: true });
    const applied2 = await applyAutoPlan(second);
    expect(applied2.deleted).toBe(1);
    expect(await db.blocks.count()).toBe(1);

    // Regenerate again: still exactly one block.
    const third = await previewAutoPlan({ days: 1, now: NOW, regenerate: true });
    await applyAutoPlan(third);
    expect(await db.blocks.count()).toBe(1);
  });

  it('regenerate never touches a block the user locked or moved manually', async () => {
    const task = buildTask({ title: 'Locked session', trackerId: 'trk_fitness', estimatedMinutes: 60 }, NOW.getTime());
    await db.tasks.add(task);
    const first = await previewAutoPlan({ days: 1, now: NOW });
    await applyAutoPlan(first);

    const [block] = await db.blocks.toArray();
    await db.blocks.update(block!.id, { locked: true });

    const second = await previewAutoPlan({ days: 1, now: NOW, regenerate: true });
    // The locked block is not in releaseBlocks and its task is still
    // "already scheduled", so nothing new is proposed for it either.
    expect(second.releaseBlocks.find((b) => b.id === block!.id)).toBeUndefined();
    await applyAutoPlan(second);
    const stillThere = await db.blocks.get(block!.id);
    expect(stillThere).toBeDefined();
    expect(stillThere!.locked).toBe(true);
  });

  it('a manually-created block (origin manual) survives regeneration untouched', async () => {
    const task = buildTask({ title: 'Manual session', trackerId: 'trk_fitness', estimatedMinutes: 60 }, NOW.getTime());
    await db.tasks.add(task);
    await db.blocks.add({
      id: newId('blk'), createdAt: Date.now(), updatedAt: Date.now(), title: 'Manual session',
      date: '2026-03-02', start: NOW.getTime() + 3600_000, end: NOW.getTime() + 7200_000,
      trackerId: 'trk_fitness', kind: 'task', taskId: task.id, goalId: null, resourceId: null,
      status: 'planned', locked: false, protected: false, origin: 'manual', planRunId: null,
      splitGroupId: null, splitIndex: 0, splitCount: 1, actualStart: null, actualEnd: null,
    });

    const preview = await previewAutoPlan({ days: 1, now: NOW, regenerate: true });
    expect(preview.releaseBlocks).toHaveLength(0); // origin 'manual' is never released
    await applyAutoPlan(preview);
    expect(await db.blocks.count()).toBe(1);
  });
});
