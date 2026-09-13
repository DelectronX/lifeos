import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { buildSnapshot, finishTimer, startTimer } from '@/services/timerService';
import { DEFAULT_TIMER_PREFERENCES } from '@/types';

/**
 * Focus Mode from the file viewer must be a REAL session through the same
 * engine every other Focus surface uses, just seeded with `resourceId`. These
 * tests prove that association survives start -> finish -> persisted
 * TimerSession -> logged Activity, which is what lets a later "sessions
 * against this file" view exist without re-deriving anything.
 */
describe('timer sessions carry a resourceId association', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) {
      await db.table(name).clear();
    }
  });

  it('buildSnapshot defaults resourceId to null when not provided', () => {
    const snap = buildSnapshot({ mode: 'stopwatch', trackerId: 'trk_1', now: 1000 }, DEFAULT_TIMER_PREFERENCES);
    expect(snap.resourceId).toBeNull();
  });

  it('buildSnapshot carries the given resourceId', () => {
    const snap = buildSnapshot(
      { mode: 'focus', trackerId: 'trk_1', resourceId: 'res_pdf_1', targetMinutes: 25, now: 1000 },
      DEFAULT_TIMER_PREFERENCES,
    );
    expect(snap.resourceId).toBe('res_pdf_1');
  });

  it('startTimer -> finishTimer persists resourceId on the TimerSession row', async () => {
    const snapshot = await startTimer({
      mode: 'focus', trackerId: 'trk_1', resourceId: 'res_pdf_1', targetMinutes: 25,
      label: 'Chapter 4.pdf', now: 1000,
    });

    const result = await finishTimer(snapshot, { completed: true, now: 1000 + 90_000 });
    expect(result).not.toBeNull();
    expect(result!.session.resourceId).toBe('res_pdf_1');

    const stored = await db.sessions.get(result!.session.id);
    expect(stored?.resourceId).toBe('res_pdf_1');
  });

  it('logs the resourceId onto the Activity record too, not just the session', async () => {
    const snapshot = await startTimer({
      mode: 'focus', trackerId: 'trk_1', resourceId: 'res_pdf_1', targetMinutes: 25, now: 1000,
    });
    const result = await finishTimer(snapshot, { completed: true, now: 1000 + 90_000 });
    expect(result).not.toBeNull();

    const activities = await db.activities.where('sessionId').equals(result!.session.id).toArray();
    expect(activities).toHaveLength(1);
    expect(activities[0]!.resourceId).toBe('res_pdf_1');
  });

  it('a session started without a resource stores resourceId: null (not undefined)', async () => {
    const snapshot = await startTimer({ mode: 'stopwatch', trackerId: 'trk_1', now: 1000 });
    const result = await finishTimer(snapshot, { completed: true, now: 1000 + 90_000 });
    expect(result).not.toBeNull();
    expect(result!.session.resourceId).toBeNull();
  });

  it('finishTimer awards XP exactly as any other focus session (Focus-from-viewer is not a parallel path)', async () => {
    const snapshot = await startTimer({
      mode: 'focus', trackerId: 'trk_1', resourceId: 'res_pdf_1', targetMinutes: 25, now: 1000,
    });
    const result = await finishTimer(snapshot, { completed: true, now: 1000 + 5 * 60_000 });
    expect(result).not.toBeNull();
    expect(result!.xpAwarded).toBeGreaterThan(0);

    const xpRows = await db.xp.where('sourceId').equals(result!.session.id).toArray();
    expect(xpRows).toHaveLength(1);
  });
});
