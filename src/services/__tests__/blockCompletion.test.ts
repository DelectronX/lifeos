import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { liveQuery } from 'dexie';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { ensureSeeded } from '@/db/seed';
import { buildBlock, completeBlock, reopenBlock, settleStartedBlocks, skipBlock, startBlock } from '@/services/scheduleService';
import { awardXP } from '@/services/xpService';
import { evaluateAchievements, readAchievements } from '@/services/achievementService';
import { createTask } from '@/services/taskService';
import type { Tracker } from '@/types';

/**
 * Regression suite for the schedule completion lifecycle.
 *
 * Root cause of the recurring "error when a block is completed":
 *  1. `evaluateAchievements()` (which WRITES) ran inside read-only
 *     `useLiveQuery` hooks and rewrote every achievement row each run, so it
 *     re-triggered itself forever; when a completion added an activity, two
 *     concurrent evaluations raced the same unlock and the second
 *     `db.xp.add` hit the unique `dedupeKey` → uncaught ConstraintError.
 *  2. `completeBlock` was neither atomic nor idempotent: a double tap or Done
 *     racing the auto-settle timer logged the completion twice.
 *  3. `awardXP` did a read-modify-write of `profile.totalXP` outside a
 *     transaction, so concurrent awards could lose XP.
 */

function tracker(id: string, extra: Partial<Tracker> = {}): Tracker {
  return {
    id, createdAt: 1, updatedAt: 1, name: id, pillar: 'study', parentId: null, color: 'indigo',
    system: false, defaultProtected: false, archived: false, sortOrder: 0, ...extra,
  };
}

describe('schedule completion lifecycle', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) await db.table(name).clear();
    await ensureSeeded();
    await db.trackers.put(tracker('trk_work'));
  });

  async function addBlock(extra: Record<string, unknown> = {}, minutesAgo = 60) {
    const start = Date.now() - minutesAgo * 60_000;
    const b = buildBlock({ trackerId: 'trk_work', title: 'Deep work', kind: 'fixed', start, end: start + 50 * 60_000, ...extra });
    b.createdAt = start - 3_600_000;
    await db.blocks.add(b);
    return b;
  }
  const completions = (blockId: string) => db.activities.where('blockId').equals(blockId).filter((a) => a.type === 'block_completed').count();

  it('completes once and returns a structured result', async () => {
    const b = await addBlock();
    const r = await completeBlock(b.id);
    expect(r.status).toBe('completed');
    expect((await db.blocks.get(b.id))?.status).toBe('completed');
    expect(await completions(b.id)).toBe(1);
  });

  it('is idempotent: a double tap logs one event and pays once', async () => {
    const b = await addBlock();
    const results = await Promise.all([completeBlock(b.id), completeBlock(b.id), completeBlock(b.id)]);
    expect(results.filter((r) => r.status === 'completed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'already_completed')).toHaveLength(2);
    expect(await completions(b.id)).toBe(1);
    expect(await db.xp.where('sourceId').equals(b.id).count()).toBeLessThanOrEqual(1);
  });

  it('manual Done racing the auto-settle produces exactly one completion', async () => {
    const b = await addBlock();
    await startBlock(b.id);
    const [manual, s1, s2] = await Promise.all([completeBlock(b.id), settleStartedBlocks(), settleStartedBlocks()]);
    expect([manual.status === 'completed' ? 1 : 0, s1, s2].reduce((a, n) => a + n, 0)).toBe(1);
    expect(await completions(b.id)).toBe(1);
  });

  it('auto-settles a started block at its planned end with the same operation', async () => {
    const b = await addBlock({}, 120);
    await startBlock(b.id);
    expect(await settleStartedBlocks()).toBe(1);
    const row = await db.blocks.get(b.id);
    expect(row?.status).toBe('completed');
    expect(row?.actualEnd).toBe(b.end);
    expect(await settleStartedBlocks()).toBe(0);
  });

  it('never auto-completes a block the user did not start', async () => {
    const b = await addBlock({}, 120);
    expect(await settleStartedBlocks()).toBe(0);
    expect((await db.blocks.get(b.id))?.status).toBe('planned');
  });

  it('handles missing and cancelled blocks without throwing', async () => {
    expect((await completeBlock('blk_missing')).status).toBe('not_found');
    const b = await addBlock();
    await db.blocks.update(b.id, { status: 'cancelled' });
    const r = await completeBlock(b.id);
    expect(r).toMatchObject({ status: 'invalid_state', blockStatus: 'cancelled' });
    expect(await completions(b.id)).toBe(0);
  });

  it('a skipped block can still be completed, once', async () => {
    const b = await addBlock();
    await skipBlock(b.id);
    expect((await completeBlock(b.id)).status).toBe('completed');
    expect((await completeBlock(b.id)).status).toBe('already_completed');
  });

  it('reopen then complete again yields one live completion (no stale duplicates)', async () => {
    const b = await addBlock();
    await completeBlock(b.id);
    await reopenBlock(b.id);
    expect((await db.blocks.get(b.id))?.status).not.toBe('completed');
    await completeBlock(b.id);
    expect(await completions(b.id)).toBe(1);
  });

  it('completes the linked task when its last block is done, exactly once', async () => {
    const task = await createTask({ title: 'Write report', trackerId: 'trk_work' } as never);
    const a = await addBlock({ taskId: task.id });
    const b = await addBlock({ taskId: task.id });
    await Promise.all([completeBlock(a.id), completeBlock(b.id)]);
    expect((await db.tasks.get(task.id))?.status).toBe('completed');
    const taskDone = await db.activities.where('taskId').equals(task.id).filter((x) => x.type === 'task_completed').count();
    expect(taskDone).toBe(1);
  });

  it('records the block on its own date even when completed after midnight', async () => {
    const start = new Date(2026, 9, 12, 23, 0).getTime();
    const b = buildBlock({ trackerId: 'trk_work', title: 'Late', kind: 'fixed', start, end: start + 50 * 60_000 });
    await db.blocks.add(b);
    await completeBlock(b.id, { at: new Date(2026, 9, 13, 0, 30).getTime() });
    const row = await db.blocks.get(b.id);
    expect(row?.date).toBe(b.date);
    expect(row?.actualEnd).toBe(b.end);
  });
});

describe('XP ledger consistency under concurrency', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) await db.table(name).clear();
    await ensureSeeded();
  });

  it('concurrent awards never lose XP: profile balance equals the ledger', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => awardXP({
      reason: 'task_completed', sourceType: 'task', sourceId: `t${i}`, minutes: 30, recordAgeSeconds: 86_400, description: `t${i}`,
    })));
    const ledger = (await db.xp.toArray()).reduce((s, t) => s + t.amount, 0);
    expect(ledger).toBeGreaterThan(0);
    expect((await db.profile.get('profile'))?.totalXP).toBe(ledger);
  });

  it('the same event awarded concurrently is paid once', async () => {
    const input = { reason: 'task_completed' as const, sourceType: 'task', sourceId: 'same', minutes: 30, recordAgeSeconds: 86_400, description: 'x' };
    await Promise.all([awardXP(input), awardXP(input), awardXP(input)]);
    expect(await db.xp.where('sourceId').equals('same').count()).toBe(1);
  });
});

describe('achievement evaluation', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) await db.table(name).clear();
    await ensureSeeded();
  });

  it('readAchievements never writes (safe inside live queries)', async () => {
    await evaluateAchievements();
    const before = JSON.stringify(await db.achievements.toArray());
    await readAchievements();
    await readAchievements();
    expect(JSON.stringify(await db.achievements.toArray())).toBe(before);
  });

  it('a second evaluation with no new data writes nothing (no self-triggering loop)', async () => {
    await evaluateAchievements();
    const before = (await db.achievements.toArray()).map((a) => a.updatedAt).join(',');
    await new Promise((r) => setTimeout(r, 5));
    await evaluateAchievements();
    expect((await db.achievements.toArray()).map((a) => a.updatedAt).join(',')).toBe(before);
  });

  it('a live read-only subscription settles instead of looping after a completion', async () => {
    let runs = 0;
    const errors: unknown[] = [];
    const sub = liveQuery(() => { runs++; return readAchievements(); }).subscribe({ error: (e) => errors.push(e) });
    await new Promise((r) => setTimeout(r, 200));
    const start = Date.now() - 3_600_000;
    const b = buildBlock({ trackerId: (await db.trackers.toArray())[0]!.id, title: 'P', kind: 'fixed', start, end: start + 50 * 60_000 });
    await db.blocks.add(b);
    const afterSetup = runs;
    await completeBlock(b.id);
    await new Promise((r) => setTimeout(r, 600));
    sub.unsubscribe();
    expect(errors).toEqual([]);
    expect(runs - afterSetup).toBeLessThanOrEqual(3);
  });

  it('concurrent evaluations unlock and pay each achievement once', async () => {
    // Enough real completions to cross early thresholds.
    for (let i = 0; i < 12; i++) {
      const start = Date.now() - (i + 2) * 3_600_000;
      const b = buildBlock({ trackerId: (await db.trackers.toArray())[0]!.id, title: `B${i}`, kind: 'fixed', start, end: start + 50 * 60_000 });
      await db.blocks.add(b);
      await completeBlock(b.id);
    }
    const results = await Promise.all([evaluateAchievements(), evaluateAchievements(), evaluateAchievements()]);
    const unlockedKeys = results.flatMap((r) => r.newlyUnlocked.map((u) => u.definition.key));
    expect(new Set(unlockedKeys).size).toBe(unlockedKeys.length);
    const events = (await db.activities.where('type').equals('achievement_unlocked').toArray()).map((a) => (a.meta as { key: string }).key);
    expect(new Set(events).size).toBe(events.length);
    const rewards = (await db.xp.where('reason').equals('achievement_reward').toArray()).map((t) => t.dedupeKey);
    expect(new Set(rewards).size).toBe(rewards.length);
  });
});
