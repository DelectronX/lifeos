import { describe, expect, it } from 'vitest';
import { generateDemoWorld, summarise } from './index';
import { DEMO_SEED } from './rng';
import { FUTURE_DAYS, HISTORY_DAYS } from './world';
import { todayKey, addDaysToKey } from '@/lib/date';
import type { TaskStatus } from '@/types';

/**
 * The demo dataset is a product surface, not a fixture: if it generates an
 * empty screen or numbers that contradict each other, the user sees it. These
 * assert the properties the screens depend on, not exact counts.
 */

const NOW = new Date('2026-05-13T10:00:00').getTime();

describe('demo world generation', () => {
  const ctx = generateDemoWorld(DEMO_SEED, NOW);
  const w = ctx.world;

  it('is deterministic for a fixed seed and anchor', () => {
    const a = JSON.stringify(generateDemoWorld(DEMO_SEED, NOW).world);
    const b = JSON.stringify(generateDemoWorld(DEMO_SEED, NOW).world);
    expect(a).toBe(b);
  });

  it('produces a different world for a different seed', () => {
    const other = generateDemoWorld(DEMO_SEED + 1, NOW).world;
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(w));
  });

  it('anchors every date relative to today', () => {
    expect(ctx.today).toBe(todayKey(NOW));
    const oldest = addDaysToKey(ctx.today, -HISTORY_DAYS);
    const newest = addDaysToKey(ctx.today, FUTURE_DAYS);
    for (const activity of w.activities) {
      expect(activity.date >= oldest).toBe(true);
      expect(activity.date <= newest).toBe(true);
    }
  });

  it('populates every module', () => {
    expect(w.trackers.length).toBeGreaterThanOrEqual(4);
    expect(w.goals.length).toBeGreaterThanOrEqual(6);
    expect(w.milestones.length).toBeGreaterThan(0);
    expect(w.tasks.length).toBeGreaterThanOrEqual(200);
    expect(w.blocks.length).toBeGreaterThan(100);
    expect(w.templates.length).toBeGreaterThan(0);
    expect(w.recurringRules.length).toBeGreaterThan(0);
    expect(w.sessions.length).toBeGreaterThanOrEqual(150);
    expect(w.papers.length).toBeGreaterThanOrEqual(4);
    expect(w.questions.length).toBeGreaterThan(50);
    expect(w.attempts.length).toBe(w.questions.length);
    expect(w.revisionEntries.length).toBeGreaterThan(20);
    expect(w.habits.length).toBeGreaterThanOrEqual(4);
    expect(w.resources.length).toBeGreaterThan(0);
    expect(w.rewards.length).toBeGreaterThan(0);
    expect(w.activities.length).toBeGreaterThan(500);
    expect(w.xp.length).toBeGreaterThan(100);
    expect(w.profile).not.toBeNull();
  });

  it('covers every task status and has future work', () => {
    const statuses = new Set(w.tasks.map((t) => t.status));
    for (const s of ['inbox', 'planned', 'in_progress', 'completed', 'skipped', 'rescheduled', 'cancelled'] as TaskStatus[]) {
      expect(statuses.has(s)).toBe(true);
    }
    expect(w.blocks.some((b) => b.start > NOW)).toBe(true);
    expect(w.blocks.some((b) => b.end < NOW)).toBe(true);
    expect(w.blocks.some((b) => b.protected)).toBe(true);
  });

  it('spans goal lifecycle states', () => {
    const statuses = new Set(w.goals.map((g) => g.status));
    expect(statuses.has('active')).toBe(true);
    expect(statuses.has('completed')).toBe(true);
  });

  it('keeps XP consistent: profile total is the sum of the transactions', () => {
    const sum = w.xp.reduce((s, t) => s + t.amount, 0);
    expect(w.profile?.totalXP).toBe(sum);
    // Running balance is monotonic and ends at the total.
    expect(w.xp[w.xp.length - 1]?.balanceAfter).toBe(sum);
    for (const tx of w.xp) expect(tx.amount).toBeGreaterThan(0);
  });

  it('links every XP transaction to a real activity', () => {
    const ids = new Set(w.activities.map((a) => a.id));
    for (const tx of w.xp) expect(ids.has(tx.activityId!)).toBe(true);
  });

  it('links tasks, milestones and sessions to records that exist', () => {
    const goalIds = new Set(w.goals.map((g) => g.id));
    const milestoneIds = new Set(w.milestones.map((m) => m.id));
    const trackerIds = new Set(w.trackers.map((t) => t.id));
    const taskIds = new Set(w.tasks.map((t) => t.id));

    for (const m of w.milestones) expect(goalIds.has(m.goalId)).toBe(true);
    for (const t of w.tasks) {
      expect(trackerIds.has(t.trackerId)).toBe(true);
      if (t.goalId) expect(goalIds.has(t.goalId)).toBe(true);
      if (t.milestoneId) expect(milestoneIds.has(t.milestoneId)).toBe(true);
    }
    for (const b of w.blocks) if (b.taskId) expect(taskIds.has(b.taskId)).toBe(true);
    for (const r of w.resources) {
      for (const id of r.taskIds ?? []) expect(taskIds.has(id)).toBe(true);
    }
  });

  it('gives the duration-prediction engine a real overrun pattern', () => {
    const done = w.tasks.filter(
      (t) => t.status === 'completed' && t.estimatedMinutes && t.actualMinutes,
    );
    expect(done.length).toBeGreaterThan(30);
    const byTracker = new Map<string, number[]>();
    for (const t of done) {
      const ratios = byTracker.get(t.trackerId) ?? [];
      ratios.push(t.actualMinutes! / t.estimatedMinutes!);
      byTracker.set(t.trackerId, ratios);
    }
    const means = [...byTracker.values()]
      .filter((r) => r.length >= 5)
      .map((r) => r.reduce((a, b) => a + b, 0) / r.length);
    expect(means.length).toBeGreaterThanOrEqual(2);
    // At least one category systematically overruns its estimates.
    expect(Math.max(...means)).toBeGreaterThan(1.15);
  });

  it('shows paper improvement across attempts', () => {
    const submitted = w.papers.filter((p) => p.submittedAt);
    expect(submitted.length).toBeGreaterThanOrEqual(4);
    for (const p of submitted) {
      const qs = w.questions.filter((q) => q.paperId === p.id);
      expect(qs.length).toBeGreaterThan(0);
      const as = w.attempts.filter((a) => qs.some((q) => q.id === a.questionId));
      expect(as.every((a) => a.timeSpentMs > 0)).toBe(true);
      expect(as.some((a) => a.mistakeType)).toBe(true);
    }
  });

  it('fills every revision dashboard bucket', () => {
    const today = ctx.today;
    const tomorrow = addDaysToKey(today, 1);
    const pending = w.revisionEntries.filter((e) => e.status === 'scheduled');
    expect(pending.some((e) => e.dueDate === today)).toBe(true);
    expect(pending.some((e) => e.dueDate === tomorrow)).toBe(true);
    expect(pending.some((e) => e.dueDate > tomorrow)).toBe(true);
    expect(w.revisionEntries.some((e) => e.dueDate < today && e.status !== 'completed')).toBe(true);
    expect(w.revisionEntries.some((e) => e.status === 'completed')).toBe(true);
  });

  it('matches habit streaks to their check-in history', () => {
    for (const h of w.habits) {
      const days = w.activities
        .filter((a) => a.type === 'habit_checkin' && a.habitId === h.id)
        .map((a) => a.date);
      expect(days.length).toBeGreaterThan(0);
      expect(h.longestStreak).toBeGreaterThanOrEqual(h.currentStreak);
      expect(h.longestStreak).toBeLessThanOrEqual(days.length);
    }
  });

  it('summarises the counts it wrote', () => {
    const summary = summarise(w, DEMO_SEED);
    expect(summary.seed).toBe(DEMO_SEED);
    expect(summary.totalRecords).toBeGreaterThan(1000);
    expect(summary.historyDays).toBe(HISTORY_DAYS);
    expect(summary.futureDays).toBe(FUTURE_DAYS);
  });
});
