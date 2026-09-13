import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { createTask, setTaskStatus } from '@/services/taskService';
import { buildBlock, completeBlock, reopenBlock } from '@/services/scheduleService';
import { getLevelProgress, getRecentXP } from '@/services/xpService';

/**
 * Proves the actual bug fixed in this pass: task and schedule-block
 * completion previously wrote an Activity but NEVER called the centralized
 * `awardXP` entrypoint (task/block completion carried no XP transaction at
 * all), and there was a second, divergent copy of the award write path
 * living in timerService.ts. Both are now fixed:
 *   - task/block completion route through the single `xpService.awardXP`.
 *   - `timerService.awardXP` is a thin adapter over that same function.
 *   - every completion is idempotent per source id (dedupeKey), and
 *     reopening a completed task/block revokes its XP so a
 *     complete -> reopen -> complete cycle cannot double-award.
 */
describe('centralized XP award routing', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) {
      await db.table(name).clear();
    }
  });

  it('awards XP exactly once when a task is completed', async () => {
    const task = await createTask({ title: 'Write report', trackerId: 'trk_1', estimatedMinutes: 30 });
    // Task is old enough to clear the anti-instant-complete age gate.
    await db.tasks.update(task.id, { createdAt: Date.now() - 60_000 });

    await setTaskStatus(task.id, 'completed', { actualMinutes: 25 });

    const rows = await db.xp.where('sourceId').equals(task.id).toArray();
    expect(rows.length).toBe(1);
    expect(rows[0].reason).toBe('task_completed');
    expect(rows[0].amount).toBeGreaterThan(0);

    const progress = await getLevelProgress();
    expect(progress.totalXP).toBe(rows[0].amount);
  });

  it('does NOT double-award on rapid double-complete (duplicate-award protection)', async () => {
    const task = await createTask({ title: 'Read paper', trackerId: 'trk_1', estimatedMinutes: 20 });
    await db.tasks.update(task.id, { createdAt: Date.now() - 60_000 });

    // Simulate a rapid double click: call the completion path twice.
    await setTaskStatus(task.id, 'completed', { actualMinutes: 20 });
    // setTaskStatus is itself a no-op on a same-status transition...
    await setTaskStatus(task.id, 'completed', { actualMinutes: 20 });
    // ...but even forcing a second real award attempt through the ledger
    // must be rejected by the unique dedupeKey.
    const { awardXP } = await import('@/services/xpService');
    const second = await awardXP({
      reason: 'task_completed',
      sourceType: 'task',
      sourceId: task.id,
      minutes: 20,
      recordAgeSeconds: 3600,
    });
    expect(second.amount).toBe(0);
    expect(second.note).toMatch(/already awarded/i);

    const rows = await db.xp.where('sourceId').equals(task.id).toArray();
    expect(rows.length).toBe(1);
  });

  it('reopening a completed task then re-completing it does not re-award', async () => {
    const task = await createTask({ title: 'Do laundry', trackerId: 'trk_1', estimatedMinutes: 15 });
    await db.tasks.update(task.id, { createdAt: Date.now() - 60_000 });

    await setTaskStatus(task.id, 'completed', { actualMinutes: 15 });
    const first = await db.xp.where('sourceId').equals(task.id).toArray();
    expect(first.length).toBe(1);

    // Reopen: XP for this task is revoked.
    await setTaskStatus(task.id, 'inbox', { reason: 'Reopened' });
    expect(await db.xp.where('sourceId').equals(task.id).count()).toBe(0);
    const afterRevoke = await getLevelProgress();
    expect(afterRevoke.totalXP).toBe(0);

    // Re-complete: the natural-key dedupe permits exactly one fresh award,
    // never two transactions coexisting for the same task.
    await setTaskStatus(task.id, 'completed', { actualMinutes: 15 });
    const second = await db.xp.where('sourceId').equals(task.id).toArray();
    expect(second.length).toBe(1);
    expect(second[0].amount).toBeGreaterThan(0);
  });

  it('awards XP when a schedule block is completed, and revokes it on reopen', async () => {
    const now = Date.now();
    const block = buildBlock({
      title: 'Study session',
      start: now - 30 * 60_000,
      end: now,
      trackerId: 'trk_1',
    }, now - 60 * 60_000);
    await db.blocks.add(block);

    await completeBlock(block.id, { at: now });
    const rows = await db.xp.where('sourceId').equals(block.id).toArray();
    expect(rows.length).toBe(1);
    expect(rows[0].reason).toBe('block_completed');

    await reopenBlock(block.id);
    expect(await db.xp.where('sourceId').equals(block.id).count()).toBe(0);
  });

  it('derived level/XP totals equal the sum of the ledger, not an independently drifting counter', async () => {
    const t1 = await createTask({ title: 'A', trackerId: 'trk_1', estimatedMinutes: 10 });
    const t2 = await createTask({ title: 'B', trackerId: 'trk_1', estimatedMinutes: 10 });
    await db.tasks.update(t1.id, { createdAt: Date.now() - 60_000 });
    await db.tasks.update(t2.id, { createdAt: Date.now() - 60_000 });
    await setTaskStatus(t1.id, 'completed', { actualMinutes: 10 });
    await setTaskStatus(t2.id, 'completed', { actualMinutes: 10 });

    const allXP = await getRecentXP(100);
    const ledgerSum = allXP.reduce((s, t) => s + t.amount, 0);
    const profile = await db.profile.get('profile');
    expect(profile?.totalXP).toBe(ledgerSum);

    const progress = await getLevelProgress();
    expect(progress.totalXP).toBe(ledgerSum);
  });

  it('timerService.awardXP delegates to the single xpService ledger (no divergent second write path)', async () => {
    const { awardXP: timerAward } = await import('@/services/timerService');
    const result = await timerAward({
      reason: 'timer_session',
      sourceType: 'session',
      sourceId: 'ses_fixed_1',
      minutes: 30,
    });
    expect(result.amount).toBeGreaterThan(0);

    const rows = await db.xp.where('sourceId').equals('ses_fixed_1').toArray();
    expect(rows.length).toBe(1);

    // Calling again for the same session is a safe no-op via the same ledger.
    const again = await timerAward({
      reason: 'timer_session',
      sourceType: 'session',
      sourceId: 'ses_fixed_1',
      minutes: 30,
    });
    expect(again.amount).toBe(0);
    expect(await db.xp.where('sourceId').equals('ses_fixed_1').count()).toBe(1);
  });
});
