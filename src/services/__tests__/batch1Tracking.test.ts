import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { ensureSeeded } from '@/db/seed';
import { buildBlock, completeBlock, reopenBlock, settleStartedBlocks, startBlock } from '@/services/scheduleService';
import { updateSchedulingConfig } from '@/services/settingsService';
import { computeTimeDistribution } from '@/engines/analytics';
import { getDailyReflection, openRequiredBlocks, saveDailyReflection } from '@/services/reflectionService';
import { descendantsOf } from '@/state/completeBlockStore';
import { cycleLabels } from '@/features/schedule/NowStrip';
import { buildContext, readCustomMetric } from '@/engines/customMetrics';
import type { CycleDefinition, Tracker } from '@/types';

function tracker(id: string, parentId: string | null, extra: Partial<Tracker> = {}): Tracker {
  return {
    id, createdAt: 1, updatedAt: 1, name: id, pillar: 'study', parentId, color: 'indigo',
    system: false, defaultProtected: false, archived: false, sortOrder: 0, ...extra,
  };
}

describe('Batch 1 — daily tracking', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) await db.table(name).clear();
    await ensureSeeded();
    await db.trackers.bulkPut([
      tracker('trk_academic', null), tracker('trk_physics', 'trk_academic'), tracker('trk_chem', 'trk_academic'),
      tracker('trk_lc', null, { unitLabel: 'problems', pillar: 'skills' }),
    ]);
  });

  async function addBlock(trackerId: string, kind: 'fixed' | 'break' = 'fixed', date = new Date('2026-10-12T18:00:00')) {
    const b = buildBlock({ trackerId, title: trackerId, kind, start: date.getTime(), end: date.getTime() + 50 * 60_000 });
    b.createdAt = date.getTime() - 3_600_000;
    await db.blocks.add(b);
    return b;
  }

  it('lists sub-subjects of a block tracker from data', async () => {
    const names = descendantsOf('trk_academic', await db.trackers.toArray()).map((t) => t.id);
    expect(names.sort()).toEqual(['trk_chem', 'trk_physics']);
  });

  it('completing with a chosen subject credits that subject and remembers the plan', async () => {
    const b = await addBlock('trk_academic');
    await completeBlock(b.id, { trackerId: 'trk_physics' });
    const after = await db.blocks.get(b.id);
    expect(after?.trackerId).toBe('trk_physics');
    expect(after?.plannedTrackerId).toBe('trk_academic');
    const act = (await db.activities.toArray()).find((a) => a.blockId === b.id);
    expect(act?.trackerId).toBe('trk_physics');
  });

  it('logged problem counts feed units:<tracker>, and only while the block is completed', async () => {
    const b = await addBlock('trk_lc');
    await completeBlock(b.id, { units: 3 });
    const metric = async () => {
      const ctx = buildContext({
        activities: await db.activities.toArray(), tasks: await db.tasks.toArray(), sessions: [], papers: [],
        blocks: await db.blocks.toArray(), goals: [], cycles: [], totalXP: 0, today: '2026-10-12',
        trackerParents: Object.fromEntries((await db.trackers.toArray()).map((t) => [t.id, t.parentId])),
      });
      return readCustomMetric('units:trk_lc', ctx);
    };
    expect(await metric()).toBe(3);
    await reopenBlock(b.id);
    expect(await metric()).toBe(0);
  });

  it('a reflection is stored once per day and re-saving replaces it', async () => {
    await saveDailyReflection('2026-10-12', { answers: { finished: 'a' }, energy: 3 });
    await saveDailyReflection('2026-10-12', { answers: { finished: 'b' }, energy: 4 }, new Date('2026-10-13T00:30:00').getTime());
    const rows = (await db.activities.toArray()).filter((a) => a.type === 'daily_review');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe('2026-10-12');
    expect((await getDailyReflection('2026-10-12'))?.answers.finished).toBe('b');
    expect((await db.settings.get('settings'))?.lastDailyReviewDate).toBe('2026-10-12');
    expect(await db.xp.count()).toBe(0);
  });

  it('close-the-day lists only open required blocks', async () => {
    const work = await addBlock('trk_academic');
    await addBlock('trk_academic', 'break', new Date('2026-10-12T19:00:00'));
    const done = await addBlock('trk_chem', 'fixed', new Date('2026-10-12T20:00:00'));
    await completeBlock(done.id);
    expect((await openRequiredBlocks('2026-10-12')).map((b) => b.id)).toEqual([work.id]);
  });

  it('cycle labels respect showOn', () => {
    const cycles: CycleDefinition[] = [
      { id: 'a', title: 'A', anchorDate: '2026-10-05', active: true, phases: [{ key: 'p', title: 'Prep Week', lengthDays: 7 }, { key: 'e', title: 'Exam Week', lengthDays: 7 }] },
      { id: 's', title: 'S', anchorDate: '2026-10-05', active: true, showOn: [0], phases: [{ key: 't', title: 'Test Sunday', lengthDays: 7 }, { key: 'n', title: 'Normal Sunday', lengthDays: 7 }] },
    ];
    expect(cycleLabels(cycles, '2026-10-07')).toEqual(['Prep Week · day 3 of 7']);
    expect(cycleLabels(cycles, '2026-10-11')).toEqual(['Prep Week · day 7 of 7', 'Test Sunday']);
    expect(cycleLabels(cycles, '2026-10-18')).toEqual(['Exam Week · day 7 of 7', 'Normal Sunday']);
  });

  it('a started block (e.g. School) is logged, earns XP and shows in analytics when it ends', async () => {
    await db.trackers.put(tracker('trk_school', null, { pillar: 'system' }));
    await updateSchedulingConfig({ xp: { trackerAwards: { trk_school: 30 } } });
    const start = new Date(Date.now() - 6 * 3_600_000);
    const school = buildBlock({ trackerId: 'trk_school', title: 'School', kind: 'fixed', start: start.getTime(), end: Date.now() - 60_000 });
    school.protected = true;
    school.createdAt = start.getTime() - 86_400_000;
    const untouched = buildBlock({ trackerId: 'trk_school', title: 'Not started', kind: 'fixed', start: start.getTime(), end: Date.now() - 60_000 });
    await db.blocks.bulkAdd([school, untouched]);

    await startBlock(school.id);
    await db.blocks.update(school.id, { actualStart: start.getTime() }); // started on time
    expect(await settleStartedBlocks(Date.now() + 1)).toBe(1);

    expect((await db.blocks.get(school.id))?.status).toBe('completed');
    expect((await db.blocks.get(untouched.id))?.status).toBe('planned');
    const xp = await db.xp.where('sourceId').equals(school.id).toArray();
    expect(xp.reduce((s, r) => s + r.amount, 0)).toBe(30);
    const acts = await db.activities.toArray();
    const dist = computeTimeDistribution(acts, await db.trackers.toArray(), '2000-01-01', '2100-01-01');
    expect(dist.byTracker.find((r) => r.id === 'trk_school')?.minutes).toBeGreaterThan(0);
    // Settling again changes nothing.
    expect(await settleStartedBlocks(Date.now() + 1)).toBe(0);
  });
});
