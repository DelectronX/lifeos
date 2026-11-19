import { liveQuery, type Subscription } from 'dexie';
import { db } from '@/db/db';
import { evaluateAchievements, type EvaluationResult } from './achievementService';

/**
 * Keeps achievements in step with real activity, independent of which page is
 * open. Watches a cheap signature of the records achievements are counted
 * from (activities, XP ledger, focus sessions, checklist runs, completed
 * tasks/blocks) and runs ONE serialised, write-side evaluation shortly after
 * any change. Live queries in the UI only ever *read* (`readAchievements`).
 */
let sub: Subscription | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSignature = '';
const listeners = new Set<(r: EvaluationResult) => void>();

export function onAchievementsEvaluated(fn: (r: EvaluationResult) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function signature(): Promise<string> {
  const [acts, xp, sessions, runs, lastAct] = await Promise.all([
    db.activities.count(), db.xp.count(), db.sessions.count(), db.checklistRuns.count(),
    db.activities.orderBy('at').last(),
  ]);
  return `${acts}:${xp}:${sessions}:${runs}:${lastAct?.id ?? ''}`;
}

export function runAchievementSyncNow(): Promise<EvaluationResult> {
  return evaluateAchievements().then((r) => {
    for (const fn of listeners) fn(r);
    return r;
  });
}

export function startAchievementSync(debounceMs = 400): void {
  if (sub) return;
  sub = liveQuery(signature).subscribe({
    next: (sig) => {
      if (sig === lastSignature) return;
      const first = lastSignature === '';
      lastSignature = sig;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        runAchievementSyncNow().catch((e) => console.error('[achievements] sync failed', e));
      }, first ? 0 : debounceMs);
    },
    error: (e) => console.error('[achievements] watcher failed', e),
  });
}

export function stopAchievementSync(): void {
  sub?.unsubscribe();
  sub = null;
  if (timer) clearTimeout(timer);
  timer = null;
  lastSignature = '';
}
