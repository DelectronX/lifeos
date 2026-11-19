import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { createDefaultSettings, ensureSeeded } from '@/db/seed';
import { addDaysToKey, minuteOfDay } from '@/lib/date';
import { cycleLengthDays, isInPhase, phaseOn } from '@/engines/cycles';
import { applyConfig, rulesForDate, validateConfig, type LifeOSConfig } from '@/services/configService';
import { applyAutoPlan, applyOverlapChoice, previewAutoPlan } from '@/services/planService';
import { buildBlock, completeBlock, reopenBlock } from '@/services/scheduleService';
import { buildTask } from '@/services/taskService';
import { currencyBalance } from '@/services/currencyService';
import { redeemReward, undoRedemption } from '@/services/rewardService';
import { recomputeGoalProgress } from '@/services/goalService';
import { evaluateAchievements } from '@/services/achievementService';
import { getLevelProgress } from '@/services/xpService';
import { importFromFile } from '@/services/backupService';
import { ACHIEVEMENT_DEFINITIONS } from '@/config/achievements';
import type { CycleDefinition, Tracker } from '@/types';

/**
 * End-to-end coverage (real Dexie on fake-indexeddb) for the generic
 * features the personal configuration file relies on. The configuration
 * itself lives in /config/lifeos-my-schedule.json — DATA, not source — and is
 * validated + applied here exactly as the Settings → Apply configuration
 * button does.
 */

const CONFIG: LifeOSConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../../../config/lifeos-my-schedule.json'), 'utf8'),
);

async function clearAll() {
  await db.open();
  for (const name of EXPORTABLE_TABLES) await db.table(name).clear();
  await db.scheduleRules.clear();
}

function tracker(id: string, name: string, parentId: string | null = null): Tracker {
  const now = Date.now();
  return {
    id, createdAt: now, updatedAt: now, name, pillar: 'study', parentId,
    color: 'indigo', system: false, defaultProtected: false, archived: false, sortOrder: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Config file: validation                                             */
/* ------------------------------------------------------------------ */

describe('configuration file — validation', () => {
  const builtin = new Set(['trk_study', 'trk_fitness', 'trk_skills', 'trk_personal', 'trk_sleep', 'trk_school', 'trk_meals', 'trk_break', 'trk_free']);

  it('is valid: unique ids/keys, real trackers, valid times, no overlapping required blocks', () => {
    const v = validateConfig(CONFIG, { trackerIds: builtin });
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('defines 58 personal achievements (42 original + 16 work & growth) → 143 with the 85 built-ins, no key collisions', () => {
    expect(ACHIEVEMENT_DEFINITIONS).toHaveLength(85);
    const keys = new Set([...ACHIEVEMENT_DEFINITIONS.map((d) => d.key), ...CONFIG.achievements!.map((a) => a.key)]);
    expect(CONFIG.achievements).toHaveLength(58);
    expect(keys.size).toBe(143);
  });

  it('rejects an overlapping REQUIRED block but allows optional/meal overlaps', () => {
    const bad: LifeOSConfig = {
      ...CONFIG,
      recurring: [
        ...CONFIG.recurring!,
        { id: 'rr_clash', title: 'Clash', trackerId: 'trk_cyber', days: [1], start: '14:15', end: '14:45' },
      ],
    };
    const v = validateConfig(bad, { trackerIds: builtin });
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.where === 'recurring.rr_clash' || i.message.includes('Clash'))).toBe(true);
  });

  it('rejects duplicate ids, bad times and unknown trackers', () => {
    const r = CONFIG.recurring![0]!;
    const v = validateConfig({
      ...CONFIG,
      recurring: [r, { ...r }, { ...r, id: 'x1', start: '25:00' }, { ...r, id: 'x2', trackerId: 'trk_nope' }],
    }, { trackerIds: builtin });
    const msgs = v.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/duplicate rule id/i);
    expect(msgs).toMatch(/HH:MM/);
    expect(msgs).toMatch(/Unknown tracker "trk_nope"/);
  });

  it('weekday schedule: workout rotation by day, LeetCode 14:00–14:30 Mon–Sat, nothing on Sunday', () => {
    const monday = '2026-10-12';
    const titles = rulesForDate(CONFIG, monday).map((r) => `${r.start} ${r.title}`);
    expect(titles).toContain('05:20 Workout — Legs + Glutes');
    expect(titles).toContain('14:00 LeetCode');
    expect(rulesForDate(CONFIG, '2026-10-13').some((r) => r.title === 'Workout — Chest + Triceps')).toBe(true);
    expect(rulesForDate(CONFIG, '2026-10-11').some((r) => r.title === 'LeetCode')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Cycle engine                                                        */
/* ------------------------------------------------------------------ */

describe('cycle engine', () => {
  const academic = CONFIG.cycles!.find((c) => c.id === 'cyc_academic')! as CycleDefinition;
  const sunday = CONFIG.cycles!.find((c) => c.id === 'cyc_sunday')! as CycleDefinition;

  it('alternates Prep and Exam weeks every 7 days, repeating every 14', () => {
    expect(cycleLengthDays(academic)).toBe(14);
    const a = academic.anchorDate;
    expect(phaseOn(academic, a)?.phase.key).toBe('prep');
    expect(phaseOn(academic, addDaysToKey(a, 6))?.phase.key).toBe('prep');
    expect(phaseOn(academic, addDaysToKey(a, 7))?.phase.key).toBe('exam');
    expect(phaseOn(academic, addDaysToKey(a, 14))?.phase.key).toBe('prep');
    expect(phaseOn(academic, addDaysToKey(a, 14 * 30 + 8))?.phase.key).toBe('exam');
  });

  it('Sunday A and B alternate', () => {
    const firstSunday = '2026-10-11';
    const second = addDaysToKey(firstSunday, 7);
    expect(isInPhase(sunday, 'test', firstSunday)).not.toBe(isInPhase(sunday, 'test', second));
    const sundayOnly = (d: string) => rulesForDate(CONFIG, d).map((r) => r.id).filter((id) => id.startsWith('rr_sun'));
    const aRules = sundayOnly(firstSunday);
    const bRules = sundayOnly(second);
    const onlyA = aRules.every((id) => id.startsWith('rr_suna_')) || aRules.every((id) => id.startsWith('rr_sunb_'));
    expect(onlyA).toBe(true);
    expect(aRules[0]!.slice(0, 8)).not.toBe(bRules[0]!.slice(0, 8));
  });

  it('exam week Mon–Thu hold a 2-hour paper; prep week holds academic deep work', () => {
    const prepMonday = addDaysToKey(academic.anchorDate, 14); // after config startDate
    const examMonday = addDaysToKey(prepMonday, 7);
    expect(rulesForDate(CONFIG, prepMonday).some((r) => r.id === 'rr_deep1_prep')).toBe(true);
    expect(rulesForDate(CONFIG, prepMonday).some((r) => r.id === 'rr_exam_paper')).toBe(false);
    const paper = rulesForDate(CONFIG, examMonday).find((r) => r.id === 'rr_exam_paper');
    expect(paper?.start).toBe('18:00');
    expect(paper?.end).toBe('20:00');
    expect(rulesForDate(CONFIG, addDaysToKey(examMonday, 4)).some((r) => r.id === 'rr_exam_paper')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Import: apply, idempotency, no history loss                         */
/* ------------------------------------------------------------------ */

describe('configuration import', () => {
  beforeEach(async () => {
    await clearAll();
    await ensureSeeded();
  });

  it('applies, materialises the recurring schedule, and re-applying creates no duplicates', async () => {
    const first = await applyConfig(CONFIG, { materialiseDays: 14, now: new Date('2026-10-12T04:00:00').getTime() });
    expect(first.ok).toBe(true);
    expect(first.blocksGenerated).toBeGreaterThan(100);
    const counts = async () => ({
      blocks: await db.blocks.count(), rules: await db.recurringRules.count(),
      achievements: await db.achievements.count(), rewards: await db.rewards.count(),
      trackers: await db.trackers.count(), goals: await db.goals.count(),
    });
    const before = await counts();
    const second = await applyConfig(CONFIG, { materialiseDays: 14, now: new Date('2026-10-12T04:00:00').getTime() });
    expect(second.ok).toBe(true);
    expect(second.blocksGenerated).toBe(0);
    expect(await counts()).toEqual(before);
    expect(Object.keys(second.created)).toHaveLength(0);
  });

  it('does not reset XP, unlocked achievements or goal progress on re-import', async () => {
    await applyConfig(CONFIG, { materialiseDays: 0 });
    await db.profile.toCollection().modify({ totalXP: 1234 });
    await db.achievements.where('key').equals('workouts_25').modify({ unlockedAt: 99, progress: 25 });
    await db.goals.update('gol_course_cs50', { status: 'completed', progress: 1, completedAt: 99 });

    await applyConfig(CONFIG, { materialiseDays: 0 });
    expect((await db.profile.toArray())[0]!.totalXP).toBe(1234);
    const ach = await db.achievements.where('key').equals('workouts_25').first();
    expect(ach?.unlockedAt).toBe(99);
    expect((await db.goals.get('gol_course_cs50'))?.status).toBe('completed');
  });

  it('an invalid file changes nothing', async () => {
    const before = await db.trackers.count();
    const res = await applyConfig({ ...CONFIG, startDate: 'tomorrow' });
    expect(res.ok).toBe(false);
    expect(await db.trackers.count()).toBe(before);
  });

  it('scheduled blocks alone never award XP or unlock anything', async () => {
    await applyConfig(CONFIG, { materialiseDays: 14 });
    expect(await db.xp.count()).toBe(0);
    expect(await db.achievements.filter((a) => !!a.unlockedAt).count()).toBe(0);
    expect(await currencyBalance()).toBe(0);
  });

  it('only the first major project is active; finishing it activates the next', async () => {
    await applyConfig(CONFIG, { materialiseDays: 0 });
    const status = async () => Object.fromEntries((await db.goals.toArray())
      .filter((g) => g.sequence).map((g) => [g.id, g.status]));
    expect(await status()).toEqual({
      gol_project_1: 'active', gol_project_2: 'paused', gol_project_3: 'paused', gol_project_4: 'paused', gol_project_5: 'paused',
    });

    // Reach every milestone the config defines for Project 1.
    const ms = await db.milestones.where('goalId').equals('gol_project_1').toArray();
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) await db.milestones.update(m.id, { completedAt: Date.now() });
    await recomputeGoalProgress('gol_project_1');
    const s = await status();
    expect(s.gol_project_1).toBe('completed');
    expect(s.gol_project_2).toBe('active');
    expect(s.gol_project_3).toBe('paused');
    const goalXP = await db.xp.where('sourceId').equals('gol_project_1').toArray();
    expect(goalXP.reduce((a, t) => a + t.amount, 0)).toBe(250);
  });
});

/* ------------------------------------------------------------------ */
/* XP, currency, optional blocks, achievements                         */
/* ------------------------------------------------------------------ */

describe('XP, reward currency and achievements from real completions', () => {
  beforeEach(async () => {
    await clearAll();
    await ensureSeeded();
    await applyConfig(CONFIG, { materialiseDays: 0 });
  });

  async function doneBlock(
    trackerId: string, title: string, start: Date, minutes: number, optional = false,
    kind: 'fixed' | 'break' = 'fixed',
  ) {
    const block = buildBlock({
      trackerId, title, start: start.getTime(), end: start.getTime() + minutes * 60_000, kind,
    });
    block.optional = optional;
    block.createdAt = start.getTime() - 3600_000;
    block.actualStart = start.getTime();
    block.actualEnd = start.getTime() + minutes * 60_000;
    await db.blocks.add(block);
    await completeBlock(block.id, { at: block.actualEnd });
    return block.id;
  }

  it('uses the per-tracker XP table, once per completion, and revokes on reopen', async () => {
    const id = await doneBlock('trk_cyber', 'Cybersecurity', new Date('2026-10-12T14:30:00'), 60);
    let rows = await db.xp.where('sourceId').equals(id).toArray();
    expect(rows.map((r) => r.amount)).toEqual([25]);
    await completeBlock(id); // repeat completion: no second award
    rows = await db.xp.where('sourceId').equals(id).toArray();
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(25);

    await reopenBlock(id);
    rows = await db.xp.where('sourceId').equals(id).toArray();
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(0);
  });

  it('breaks, music and free time earn no XP', async () => {
    await doneBlock('trk_music', 'Music', new Date('2026-10-12T05:10:00'), 10, false, 'break');
    await doneBlock('trk_free', 'Anime', new Date('2026-10-12T23:00:00'), 60, true, 'break');
    expect((await db.xp.toArray()).reduce((s, r) => s + r.amount, 0)).toBe(0);
  });

  it('XP mints reward currency 1:1; redeeming spends currency but never XP', async () => {
    await doneBlock('trk_cyber', 'Cybersecurity', new Date('2026-10-12T14:30:00'), 60);
    await doneBlock('trk_leetcode', 'LeetCode', new Date('2026-10-12T14:00:00'), 30);
    const before = await getLevelProgress();
    const balance = await currencyBalance();
    const xpEarned = (await db.xp.toArray()).reduce((s, t) => s + t.amount, 0);
    // 25 (cyber) + 15 (LeetCode) + the data-defined full-day bonus.
    expect(xpEarned).toBe(40 + (CONFIG.xp?.fullDayBonus ?? 0));
    expect(balance).toBe(xpEarned);

    await db.rewards.update('rwd_1', { cost: balance + 1 });
    const tooExpensive = await redeemReward('rwd_1');
    expect(tooExpensive.ok).toBe(false);
    expect(await currencyBalance()).toBe(balance);

    await db.rewards.update('rwd_1', { cost: 30 });
    const ok = await redeemReward('rwd_1');
    expect(ok.ok).toBe(true);
    expect(await currencyBalance()).toBe(balance - 30);
    expect((await getLevelProgress()).totalXP).toBe(before.totalXP);

    await undoRedemption(ok.earning!.id);
    expect(await currencyBalance()).toBe(balance);
  });

  it('data-defined achievements unlock from real work only, banking their XP once', async () => {
    let r = await evaluateAchievements();
    expect(r.newlyUnlocked.map((u) => u.definition.key)).not.toContain('cybersecurity_10h');

    for (let d = 0; d < 10; d++) {
      await doneBlock('trk_cyber', 'Cybersecurity', new Date(2026, 9, 5 + d, 14, 30), 60);
    }
    r = await evaluateAchievements();
    expect(r.newlyUnlocked.map((u) => u.definition.key)).toContain('cybersecurity_10h');
    const again = await evaluateAchievements();
    expect(again.newlyUnlocked.map((u) => u.definition.key)).not.toContain('cybersecurity_10h');
    const banked = await db.xp.filter((t) => t.reason === 'achievement_reward' && t.sourceId === 'cybersecurity_10h').toArray();
    expect(banked.reduce((s, t) => s + t.amount, 0)).toBe(200);
    expect(await db.achievements.count()).toBe(143);
  });

  it('late study counts only sessions starting at or after 22:00', async () => {
    await doneBlock('trk_academic', 'Study', new Date('2026-10-12T21:50:00'), 50);
    await doneBlock('trk_physics', 'Physics', new Date('2026-10-13T22:00:00'), 30);
    await evaluateAchievements();
    const row = await db.achievements.where('key').equals('late_study_10').first();
    expect(row?.progress).toBe(1);
  });

  it('balanced day needs fitness + skills + academics on the same date', async () => {
    await doneBlock('trk_workout', 'Workout', new Date('2026-10-12T05:20:00'), 55);
    await doneBlock('trk_cyber', 'Cyber', new Date('2026-10-12T14:30:00'), 60);
    await doneBlock('trk_physics', 'Physics', new Date('2026-10-13T18:00:00'), 50); // different day
    await evaluateAchievements();
    expect((await db.achievements.where('key').equals('balanced_day_10').first())?.progress).toBe(0);
    await doneBlock('trk_maths', 'Maths', new Date('2026-10-12T21:50:00'), 50);
    await evaluateAchievements();
    expect((await db.achievements.where('key').equals('balanced_day_10').first())?.progress).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Auto Plan: same-area hosting and confirmed overlap                  */
/* ------------------------------------------------------------------ */

describe('Auto Plan — occupied slots', () => {
  const NOW = new Date('2026-03-02T06:00:00'); // Monday

  beforeEach(async () => {
    await clearAll();
    await db.settings.put(createDefaultSettings());
    await db.trackers.bulkAdd([
      tracker('trk_academic', 'Academics'),
      tracker('trk_physics', 'Physics', 'trk_academic'),
      tracker('trk_chem', 'Chemistry', 'trk_academic'),
      tracker('trk_gym', 'Gym'),
    ]);
  });

  /** Fill the planning day so the only room is inside existing blocks. */
  async function occupy(trackerId: string, title: string, fromH: number, toH: number) {
    const b = buildBlock({
      trackerId, title, kind: 'fixed',
      start: new Date(2026, 2, 2, fromH).getTime(), end: new Date(2026, 2, 2, toH).getTime(),
    });
    await db.blocks.add(b);
    return b;
  }

  it('a Physics task goes inside the Physics slot instead of "no free slot"', async () => {
    await occupy('trk_gym', 'Busy', 6, 18);
    const physics = await occupy('trk_physics', 'Physics', 18, 19);
    await occupy('trk_gym', 'Busy', 19, 24);
    await db.tasks.add(buildTask({ title: 'Physics homework', trackerId: 'trk_physics', estimatedMinutes: 45 }, NOW.getTime() - 3600_000));

    const preview = await previewAutoPlan({ days: 1, now: NOW });
    expect(preview.result.unplaced).toEqual([]);
    const p = preview.result.proposals[0]!;
    expect(p.hostBlockId).toBe(physics.id);
    expect(minuteOfDay(p.start)).toBeGreaterThanOrEqual(18 * 60);
    expect(minuteOfDay(p.end - 1)).toBeLessThan(19 * 60);
  });

  it('a different-area slot is never used silently — it is offered as a choice', async () => {
    await occupy('trk_gym', 'Busy', 6, 18);
    const chem = await occupy('trk_chem', 'Chemistry', 18, 19);
    await occupy('trk_gym', 'Busy', 19, 24);
    await db.tasks.add(buildTask({ title: 'Physics homework', trackerId: 'trk_physics', estimatedMinutes: 45 }, NOW.getTime() - 3600_000));

    const preview = await previewAutoPlan({ days: 1, now: NOW });
    expect(preview.result.proposals).toEqual([]);
    const un = preview.result.unplaced[0]!;
    expect(un.overlapOptions?.length).toBeGreaterThan(0);
    expect(un.overlapOptions!.some((o) => o.blockId === chem.id)).toBe(true);

    // User picks the Chemistry slot explicitly.
    const option = un.overlapOptions!.find((o) => o.blockId === chem.id)!;
    const res = await applyOverlapChoice(un.taskId, option);
    expect(res.created).toBe(1);
    const placed = await db.blocks.where('taskId').equals(un.taskId).first();
    expect(placed?.start).toBeGreaterThanOrEqual(chem.start);
    expect(placed?.end).toBeLessThanOrEqual(chem.end);
    expect(await db.blocks.get(chem.id)).toBeTruthy(); // host untouched

    // Applying the auto plan alone never creates the overlap.
    const re = await applyAutoPlan(await previewAutoPlan({ days: 1, now: NOW }));
    expect(re.created).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The normal Settings → Import button                                 */
/* ------------------------------------------------------------------ */

describe('importing the config through the regular Import button', () => {
  beforeEach(async () => {
    await clearAll();
    await ensureSeeded();
  });

  const file = () => new File(
    [readFileSync(resolve(__dirname, '../../../config/lifeos-my-schedule.json'), 'utf8')],
    'lifeos-my-schedule.json', { type: 'application/json' },
  );

  it('is recognised (no "lifeos-export format marker" error) and merges everything in', async () => {
    const res = await importFromFile(file(), 'replace');
    expect(res.message).not.toMatch(/format marker/);
    expect(res.ok).toBe(true);
    expect(await db.trackers.count()).toBe(CONFIG.trackers!.length);
    expect(await db.recurringRules.count()).toBe(CONFIG.recurring!.length);
    expect(await db.achievements.count()).toBe(143);
    expect(await db.rewards.count()).toBe(CONFIG.rewards!.length);
    expect(await db.goals.count()).toBe(CONFIG.goals!.length);
    expect(await db.blocks.count()).toBeGreaterThan(0);
    expect((await db.profile.get('profile'))?.displayName).toBe(CONFIG.profile?.displayName);
    const settings = await db.settings.get('settings');
    expect(settings?.cycles?.map((c) => c.id).sort()).toEqual(['cyc_academic', 'cyc_sunday']);
    expect(settings?.workingHours?.[1]?.[0]).toEqual({ startMinute: 300, endMinute: 1440 });
  });

  it('importing it twice gives the same data, and never wipes existing history', async () => {
    await importFromFile(file(), 'replace');
    await db.xp.add({
      id: 'xp_hist', createdAt: 1, updatedAt: 1, at: 1, date: '2026-10-01', amount: 77, reason: 'task_completed',
      description: 'old', sourceType: 'task', sourceId: 't', activityId: null, dedupeKey: 'old', balanceAfter: 77,
    });
    const blocks = await db.blocks.count();
    const res = await importFromFile(file(), 'replace');
    expect(res.ok).toBe(true);
    expect(await db.blocks.count()).toBe(blocks);
    expect(await db.xp.get('xp_hist')).toBeTruthy();
  });

  it('a normal backup export still restores as before', async () => {
    const backup = new File([JSON.stringify({
      format: 'lifeos-export', schemaVersion: 8, appVersion: '1', exportedAt: 1,
      tables: { tasks: [], goals: [] },
    })], 'b.json');
    const res = await importFromFile(backup, 'merge');
    expect(res.ok).toBe(true);
  });
});
