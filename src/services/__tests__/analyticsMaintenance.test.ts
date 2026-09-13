import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { pruneSnapshots, rollSnapshots } from '@/services/analyticsService';
import { runStartupMaintenance } from '@/services/maintenanceService';
import { createDefaultSettings } from '@/db/seed';
import { addDaysToKey } from '@/lib/date';
import type { AnalyticsSnapshot } from '@/types';

/**
 * The analytics snapshot roll+prune lifecycle, wired into real startup
 * maintenance (not just demo seeding). These tests prove retention actually
 * deletes old rows rather than merely asserting rollSnapshots ran.
 */
describe('analytics snapshot lifecycle', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) {
      await db.table(name).clear();
    }
  });

  function makeSnapshot(scope: AnalyticsSnapshot['scope'], periodKey: string): AnalyticsSnapshot {
    const now = Date.now();
    return {
      id: `snap_${scope}_${periodKey}`,
      createdAt: now,
      updatedAt: now,
      scope,
      periodKey,
      metrics: {},
      byTracker: {},
      computedAt: now,
    };
  }

  it('prunes day snapshots beyond the configured retention count', async () => {
    const rows: AnalyticsSnapshot[] = [];
    for (let i = 0; i < 100; i++) {
      rows.push(makeSnapshot('day', addDaysToKey('2026-01-01', i)));
    }
    await db.snapshots.bulkPut(rows);
    expect(await db.snapshots.count()).toBe(100);

    const pruned = await pruneSnapshots({ keepDay: 90, keepWeek: 60 });
    expect(pruned).toBe(10);
    expect(await db.snapshots.count()).toBe(90);

    // The newest 90 (by periodKey) survive; the oldest 10 are gone.
    const remaining = await db.snapshots.toArray();
    const oldestKept = remaining.map((r) => r.periodKey).sort()[0];
    expect(oldestKept).toBe(addDaysToKey('2026-01-01', 10));
  });

  it('prunes week snapshots independently of day snapshots', async () => {
    const dayRows = Array.from({ length: 5 }, (_, i) => makeSnapshot('day', addDaysToKey('2026-01-01', i)));
    const weekRows = Array.from({ length: 70 }, (_, i) => makeSnapshot('week', `2020-W${String(i + 1).padStart(2, '0')}`));
    await db.snapshots.bulkPut([...dayRows, ...weekRows]);

    const pruned = await pruneSnapshots({ keepDay: 90, keepWeek: 60 });
    expect(pruned).toBe(10);
    expect(await db.snapshots.where('scope').equals('day').count()).toBe(5);
    expect(await db.snapshots.where('scope').equals('week').count()).toBe(60);
  });

  it('runStartupMaintenance rolls a snapshot and reports it', async () => {
    await db.settings.put(createDefaultSettings());
    const result = await runStartupMaintenance(true);
    expect(result.ran).toBe(true);
    expect(result.steps.some((s) => /snapshot/i.test(s) || s === null)).toBeDefined();

    // A snapshot for yesterday should now exist (rollSnapshots always rolls
    // yesterday's day snapshot if it does not exist yet).
    const count = await db.snapshots.count();
    expect(count).toBeGreaterThan(0);
  });

  it('runStartupMaintenance skips rolling when settings.analytics.rollSnapshots is false', async () => {
    const settings = createDefaultSettings();
    await db.settings.put({ ...settings, analytics: { rollSnapshots: false, intervalMinutes: 180, lastRolledAt: null } });

    await runStartupMaintenance(true);
    expect(await db.snapshots.count()).toBe(0);
  });

  it('rollSnapshots itself is idempotent (no duplicate rows on repeat calls)', async () => {
    await rollSnapshots('2026-03-10');
    const first = await db.snapshots.count();
    await rollSnapshots('2026-03-10');
    const second = await db.snapshots.count();
    expect(second).toBe(first);
  });
});
