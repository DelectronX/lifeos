import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { toDateKey, MINUTE_MS } from '@/lib/date';
import { logActivity } from './activityService';
import { getSettings } from './settingsService';
import { getUiState, setUiState } from './uiStateStore';
import { awardXP as xpServiceAwardXP } from './xpService';
import type { XPEventInput } from '@/engines/xp';
import { DEFAULT_TIMER_PREFERENCES } from '@/types';
import type {
  ID, PomodoroPhase, TimerMode, TimerPreferences, TimerSegment, TimerSession,
} from '@/types';

/**
 * TimerService — the persistent timer core.
 *
 * Design rule: elapsed time is NEVER counted by an interval. The running timer
 * stores wall-clock timestamps (`startedAt`, closed `segments`, and the open
 * `runningSince`) and every duration is derived from `Date.now()` against those
 * timestamps. That makes the timer correct across tab throttling, sleeping
 * laptops, and full page refreshes: restoring the snapshot and recomputing gives
 * exactly the real elapsed time.
 *
 * The live snapshot lives in localStorage (small, synchronous, survives reload).
 * Only finished sessions are written to IndexedDB, as real TimerSession rows
 * plus an Activity record — which is what analytics, XP and goals read.
 */

const STORAGE_KEY = 'timer.active';
const SNAPSHOT_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Snapshot model                                                      */
/* ------------------------------------------------------------------ */

export type TimerRunState = 'running' | 'paused';

export interface TimerSnapshot {
  version: number;
  /** Id reserved at start; becomes the TimerSession id on completion. */
  id: ID;
  mode: TimerMode;
  trackerId: ID;
  taskId: ID | null;
  blockId: ID | null;
  goalId: ID | null;
  paperId: ID | null;
  /** Resource (PDF/video/image/txt) this session was started from, if any. */
  resourceId: ID | null;
  /** Wall-clock time the timer was first started. */
  startedAt: number;
  /** Closed run segments. Open time is tracked by `runningSince`. */
  segments: TimerSegment[];
  /** Set while running; null while paused. */
  runningSince: number | null;
  /** Target duration in ms. Countdown/pomodoro/focus-with-target use it. */
  plannedMs: number | null;
  /** Current pomodoro phase; always `work` for the other modes. */
  phase: PomodoroPhase;
  /** Completed work phases in this pomodoro run. */
  pomodoroCount: number;
  /** Pause count — a proxy for interruptions. */
  interruptions: number;
  label: string;
  notes?: string;
  pomodoro: TimerPreferences;
}

export interface TimerReading {
  /** Time spent in work phases, ms. */
  workMs: number;
  /** Time spent in break phases, ms. */
  breakMs: number;
  /** Elapsed in the CURRENT phase, ms. */
  phaseMs: number;
  /** Total elapsed across every phase, ms. */
  elapsedMs: number;
  /** For countdown/pomodoro/targets: ms left in this phase (never negative). */
  remainingMs: number | null;
  /** True once a planned phase has run past its target. */
  phaseComplete: boolean;
  /** 0..1 against the phase target; 0 when open-ended. */
  progress: number;
  state: TimerRunState;
}

/* ------------------------------------------------------------------ */
/* Pure timer maths (no DOM, no DB) — the testable heart of the core   */
/* ------------------------------------------------------------------ */

function segmentMs(seg: TimerSegment): number {
  return Math.max(0, seg.end - seg.start);
}

/** Ms accumulated in closed segments matching `phase`. */
export function closedMsForPhase(snapshot: TimerSnapshot, phase: PomodoroPhase): number {
  return snapshot.segments
    .filter((s) => (s.phase ?? 'work') === phase)
    .reduce((sum, s) => sum + segmentMs(s), 0);
}

/** Ms accumulated in the current (possibly open) phase. */
export function currentPhaseMs(snapshot: TimerSnapshot, now: number): number {
  const closed = closedMsForPhase(snapshot, snapshot.phase);
  const open = snapshot.runningSince === null ? 0 : Math.max(0, now - snapshot.runningSince);
  return closed + open;
}

/** Target duration for the phase the timer is currently in. */
export function phaseTargetMs(snapshot: TimerSnapshot): number | null {
  if (snapshot.mode === 'pomodoro') {
    const p = snapshot.pomodoro;
    if (snapshot.phase === 'work') return Math.max(1, p.pomodoroWorkMinutes) * MINUTE_MS;
    if (snapshot.phase === 'short_break') return Math.max(1, p.pomodoroShortBreakMinutes) * MINUTE_MS;
    return Math.max(1, p.pomodoroLongBreakMinutes) * MINUTE_MS;
  }
  return snapshot.plannedMs;
}

/**
 * The single reader every UI surface uses. Derives every number from wall-clock
 * timestamps, so it is correct no matter how long the tab was suspended.
 */
export function readTimer(snapshot: TimerSnapshot, now: number = Date.now()): TimerReading {
  const openMs = snapshot.runningSince === null ? 0 : Math.max(0, now - snapshot.runningSince);
  const closedWork = closedMsForPhase(snapshot, 'work');
  const closedBreak =
    closedMsForPhase(snapshot, 'short_break') + closedMsForPhase(snapshot, 'long_break');
  const openIsBreak = snapshot.phase !== 'work';

  const workMs = closedWork + (openIsBreak ? 0 : openMs);
  const breakMs = closedBreak + (openIsBreak ? openMs : 0);
  const phaseMs = currentPhaseMs(snapshot, now);
  const target = phaseTargetMs(snapshot);

  // A countdown counts down its target; every other mode counts up.
  const remainingMs = target === null ? null : Math.max(0, target - phaseMs);
  const phaseComplete = target !== null && phaseMs >= target;

  return {
    workMs,
    breakMs,
    phaseMs,
    elapsedMs: workMs + breakMs,
    remainingMs,
    phaseComplete,
    progress: target && target > 0 ? Math.min(1, phaseMs / target) : 0,
    state: snapshot.runningSince === null ? 'paused' : 'running',
  };
}

/** Closes the open segment (if any) and returns the next snapshot. Pure. */
export function pauseSnapshot(snapshot: TimerSnapshot, now: number = Date.now()): TimerSnapshot {
  if (snapshot.runningSince === null) return snapshot;
  const segment: TimerSegment = { start: snapshot.runningSince, end: Math.max(snapshot.runningSince, now), phase: snapshot.phase };
  return {
    ...snapshot,
    segments: [...snapshot.segments, segment],
    runningSince: null,
    interruptions: snapshot.interruptions + 1,
  };
}

/** Opens a new segment from `now`. Pure. */
export function resumeSnapshot(snapshot: TimerSnapshot, now: number = Date.now()): TimerSnapshot {
  if (snapshot.runningSince !== null) return snapshot;
  return { ...snapshot, runningSince: now };
}

/** Which phase follows the current one in a pomodoro cycle. */
export function nextPomodoroPhase(snapshot: TimerSnapshot): { phase: PomodoroPhase; pomodoroCount: number } {
  if (snapshot.phase === 'work') {
    const count = snapshot.pomodoroCount + 1;
    const every = Math.max(1, snapshot.pomodoro.pomodorosBeforeLongBreak);
    return { phase: count % every === 0 ? 'long_break' : 'short_break', pomodoroCount: count };
  }
  return { phase: 'work', pomodoroCount: snapshot.pomodoroCount };
}

/** Advances a pomodoro to its next phase, closing the open segment. Pure. */
export function advancePomodoro(snapshot: TimerSnapshot, now: number = Date.now(), autoStart = true): TimerSnapshot {
  const closed = snapshot.runningSince === null
    ? snapshot
    : { ...snapshot, segments: [...snapshot.segments, { start: snapshot.runningSince, end: now, phase: snapshot.phase }], runningSince: null };
  const { phase, pomodoroCount } = nextPomodoroPhase(snapshot);
  return {
    ...closed,
    phase,
    pomodoroCount,
    // Phase changes are not interruptions.
    interruptions: snapshot.interruptions,
    runningSince: autoStart ? now : null,
  };
}

/* ------------------------------------------------------------------ */
/* Snapshot persistence                                                */
/* ------------------------------------------------------------------ */

function isSnapshot(value: unknown): value is TimerSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<TimerSnapshot>;
  return (
    typeof v.id === 'string' &&
    typeof v.mode === 'string' &&
    typeof v.startedAt === 'number' &&
    Array.isArray(v.segments) &&
    (v.runningSince === null || typeof v.runningSince === 'number')
  );
}

export function loadSnapshot(): TimerSnapshot | null {
  try {
    const parsed = getUiState<unknown>(STORAGE_KEY, null);
    if (!parsed) return null;
    if (!isSnapshot(parsed)) return null;
    return {
      ...parsed,
      pomodoro: { ...DEFAULT_TIMER_PREFERENCES, ...(parsed.pomodoro ?? {}) },
    };
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: TimerSnapshot | null): void {
  setUiState(STORAGE_KEY, snapshot === undefined ? null : snapshot);
}

/* ------------------------------------------------------------------ */
/* Starting a timer                                                    */
/* ------------------------------------------------------------------ */

export interface StartTimerInput {
  mode: TimerMode;
  trackerId: ID;
  taskId?: ID | null;
  blockId?: ID | null;
  goalId?: ID | null;
  paperId?: ID | null;
  /** Resource (PDF/video/image/txt) this session is started from, if any. */
  resourceId?: ID | null;
  /** Target minutes for focus/countdown. Ignored by stopwatch. */
  targetMinutes?: number | null;
  label?: string;
  notes?: string;
  pomodoro?: TimerPreferences;
  now?: number;
}

export async function readTimerPreferences(): Promise<TimerPreferences> {
  try {
    const settings = await getSettings();
    return { ...DEFAULT_TIMER_PREFERENCES, ...(settings.timers ?? {}) };
  } catch {
    return DEFAULT_TIMER_PREFERENCES;
  }
}

export function buildSnapshot(input: StartTimerInput, prefs: TimerPreferences): TimerSnapshot {
  const now = input.now ?? Date.now();
  const target = input.targetMinutes && input.targetMinutes > 0 ? input.targetMinutes * MINUTE_MS : null;
  const plannedMs =
    input.mode === 'pomodoro' ? Math.max(1, prefs.pomodoroWorkMinutes) * MINUTE_MS
    : input.mode === 'stopwatch' ? null
    : target;
  return {
    version: SNAPSHOT_VERSION,
    id: newId('ses'),
    mode: input.mode,
    trackerId: input.trackerId,
    taskId: input.taskId ?? null,
    blockId: input.blockId ?? null,
    goalId: input.goalId ?? null,
    paperId: input.paperId ?? null,
    resourceId: input.resourceId ?? null,
    startedAt: now,
    segments: [],
    runningSince: now,
    plannedMs,
    phase: 'work',
    pomodoroCount: 0,
    interruptions: 0,
    label: input.label?.trim() || defaultLabel(input.mode),
    notes: input.notes,
    pomodoro: prefs,
  };
}

function defaultLabel(mode: TimerMode): string {
  switch (mode) {
    case 'focus': return 'Focus session';
    case 'pomodoro': return 'Pomodoro';
    case 'stopwatch': return 'Stopwatch';
    case 'countdown': return 'Countdown';
    case 'paper': return 'Paper attempt';
    case 'question': return 'Question drill';
    default: return 'Session';
  }
}

/**
 * Starts a timer and marks its linked task in progress. Returns the snapshot;
 * the caller (the store) owns persisting it.
 */
export async function startTimer(input: StartTimerInput): Promise<TimerSnapshot> {
  const prefs = input.pomodoro ?? (await readTimerPreferences());
  const snapshot = buildSnapshot(input, prefs);
  saveSnapshot(snapshot);
  if (snapshot.taskId) {
    const task = await db.tasks.get(snapshot.taskId);
    if (task && (task.status === 'inbox' || task.status === 'planned' || task.status === 'rescheduled')) {
      const { setTaskStatus } = await import('./taskService');
      await setTaskStatus(task.id, 'in_progress', { reason: 'Timer started' });
    }
  }
  return snapshot;
}

/* ------------------------------------------------------------------ */
/* Finishing a timer                                                   */
/* ------------------------------------------------------------------ */

export interface FinishTimerOptions {
  /** True when the timer reached its target / the user pressed Complete. */
  completed: boolean;
  /** Also mark the linked task complete. */
  completeTask?: boolean;
  notes?: string;
  now?: number;
}

export interface FinishTimerResult {
  session: TimerSession;
  /** XP actually credited after anti-farming caps. */
  xpAwarded: number;
  /** Set when the award was reduced or refused, for honest UI copy. */
  xpNote?: string;
  levelUp: boolean;
  level: number;
}

/**
 * Ends a run: writes the real TimerSession row, the Activity record, rolls the
 * time up onto the linked task, and awards XP through the XP engine.
 * Sessions shorter than a second are discarded rather than stored as noise.
 */
export async function finishTimer(
  snapshot: TimerSnapshot,
  options: FinishTimerOptions,
): Promise<FinishTimerResult | null> {
  const now = options.now ?? Date.now();
  const wasRunning = snapshot.runningSince !== null;
  const closed = pauseSnapshot(snapshot, now);
  const reading = readTimer({ ...closed, runningSince: null }, now);

  saveSnapshot(null);

  if (reading.elapsedMs < 1000) return null;

  const session: TimerSession = {
    id: closed.id,
    createdAt: closed.startedAt,
    updatedAt: now,
    mode: closed.mode,
    taskId: closed.taskId,
    blockId: closed.blockId,
    goalId: closed.goalId,
    trackerId: closed.trackerId,
    paperId: closed.paperId,
    resourceId: closed.resourceId,
    startedAt: closed.startedAt,
    endedAt: now,
    workMs: Math.round(reading.workMs),
    breakMs: Math.round(reading.breakMs),
    plannedMs: closed.plannedMs,
    // The final stop closes a segment but is not a real interruption.
    segments: closed.segments,
    pomodoroCount: closed.pomodoroCount,
    interruptions: Math.max(0, closed.interruptions - (wasRunning ? 1 : 0)),
    completed: options.completed,
    notes: options.notes ?? closed.notes,
    date: toDateKey(closed.startedAt),
  };

  await db.sessions.add(session);

  const workMinutes = session.workMs / MINUTE_MS;

  const activity = await logActivity({
    type: 'timer_session',
    title: closed.label,
    at: now,
    trackerId: session.trackerId,
    taskId: session.taskId,
    goalId: session.goalId,
    blockId: session.blockId,
    sessionId: session.id,
    paperId: session.paperId,
    resourceId: session.resourceId,
    durationMs: session.workMs,
    value: Math.round(workMinutes),
    unit: 'minutes',
    meta: {
      mode: session.mode,
      pomodoroCount: session.pomodoroCount,
      interruptions: session.interruptions,
      breakMs: session.breakMs,
      plannedMs: session.plannedMs,
      completed: session.completed,
    },
  });

  // Roll real time onto the task and (optionally) close it out.
  if (session.taskId) {
    const task = await db.tasks.get(session.taskId);
    if (task) {
      const actualMinutes = Math.round(task.actualMinutes + workMinutes);
      await db.tasks.update(task.id, { actualMinutes, updatedAt: now });
      if (options.completeTask) {
        const { setTaskStatus } = await import('./taskService');
        await setTaskStatus(task.id, 'completed', { actualMinutes, reason: 'Completed from timer' });
      }
    }
  }

  // Mark the linked schedule block as actually worked.
  if (session.blockId) {
    const block = await db.blocks.get(session.blockId);
    if (block) {
      await db.blocks.update(block.id, {
        actualStart: block.actualStart ?? session.startedAt,
        actualEnd: now,
        status: options.completeTask ? 'completed' : block.status === 'planned' ? 'in_progress' : block.status,
        updatedAt: now,
      });
    }
  }

  const award = await awardXP({
    reason: 'timer_session',
    sourceType: 'session',
    sourceId: session.id,
    minutes: workMinutes,
    description: `${closed.label} — ${Math.round(workMinutes)} min`,
  }, activity.id);

  return {
    session,
    xpAwarded: award.amount,
    xpNote: award.note,
    levelUp: award.levelUp,
    level: award.level,
  };
}

/** Remaining minutes on a task once timer time is accounted for. */
export function remainingTaskMinutes(estimatedMinutes: number, actualMinutes: number): number {
  return Math.max(0, Math.round(estimatedMinutes - actualMinutes));
}

/* ------------------------------------------------------------------ */
/* XP write path                                                       */
/* ------------------------------------------------------------------ */

export interface AwardResult {
  amount: number;
  note?: string;
  levelUp: boolean;
  level: number;
}

/**
 * Shared XP write path for the Focus/Paper modules.
 *
 * This is a thin adapter over the ONE centralized award entrypoint,
 * `xpService.awardXP` — every feature (tasks, blocks, timers, papers,
 * revisions, habits) routes through that single function so the dedupe
 * ledger, daily caps and level/streak bookkeeping can never diverge between
 * call sites. This file used to carry its own duplicate copy of that write
 * path; it now only adapts the richer `XPAwardOutcome` shape to the smaller
 * `AwardResult` shape the Focus/Paper UIs already consume.
 */
export async function awardXP(input: XPEventInput, activityId: ID | null = null): Promise<AwardResult> {
  const outcome = await xpServiceAwardXP(input, { activityId });
  return {
    amount: outcome.amount,
    note: outcome.note,
    levelUp: outcome.levelUp,
    level: outcome.level,
  };
}

/* ------------------------------------------------------------------ */
/* Notifications (graceful degradation is mandatory)                   */
/* ------------------------------------------------------------------ */

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  try { return Notification.permission; } catch { return 'unsupported'; }
}

/** Requests permission. Resolves false on any failure — never throws. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  try {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

/**
 * Fires a completion notification if — and only if — the browser supports it
 * and the user granted permission. Any failure is swallowed: a timer must never
 * break because notifications are unavailable.
 */
export function notify(title: string, body?: string): boolean {
  try {
    if (!notificationsSupported() || Notification.permission !== 'granted') return false;
    const n = new Notification(title, { body, tag: 'lifeos-timer', silent: false });
    setTimeout(() => { try { n.close(); } catch { /* ignore */ } }, 12_000);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Session history queries                                             */
/* ------------------------------------------------------------------ */

export interface SessionHistoryFilter {
  mode?: TimerMode | 'all';
  trackerId?: ID | 'all';
  /** Inclusive day range. */
  from?: string;
  to?: string;
  limit?: number;
}

export async function listSessions(filter: SessionHistoryFilter = {}): Promise<TimerSession[]> {
  const limit = filter.limit ?? 200;
  let rows: TimerSession[] =
    filter.from && filter.to
      ? await db.sessions.where('date').between(filter.from, filter.to, true, true).toArray()
      : await db.sessions.orderBy('startedAt').reverse().limit(limit * 2).toArray();

  if (filter.mode && filter.mode !== 'all') rows = rows.filter((s) => s.mode === filter.mode);
  if (filter.trackerId && filter.trackerId !== 'all') rows = rows.filter((s) => s.trackerId === filter.trackerId);
  return rows.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export interface SessionTotals {
  count: number;
  workMs: number;
  breakMs: number;
  pomodoros: number;
  completed: number;
}

/** Pure rollup used by the history header. */
export function summariseSessions(sessions: TimerSession[]): SessionTotals {
  return sessions.reduce<SessionTotals>(
    (acc, s) => ({
      count: acc.count + 1,
      workMs: acc.workMs + s.workMs,
      breakMs: acc.breakMs + s.breakMs,
      pomodoros: acc.pomodoros + s.pomodoroCount,
      completed: acc.completed + (s.completed ? 1 : 0),
    }),
    { count: 0, workMs: 0, breakMs: 0, pomodoros: 0, completed: 0 },
  );
}

export async function deleteSession(id: ID): Promise<void> {
  const session = await db.sessions.get(id);
  if (!session) return;
  await db.transaction('rw', [db.sessions, db.activities, db.tasks], async () => {
    const acts = await db.activities.where('sessionId').equals(id).toArray();
    await db.activities.bulkDelete(acts.map((a) => a.id));
    if (session.taskId) {
      const task = await db.tasks.get(session.taskId);
      if (task) {
        await db.tasks.update(task.id, {
          actualMinutes: Math.max(0, Math.round(task.actualMinutes - session.workMs / MINUTE_MS)),
          updatedAt: Date.now(),
        });
      }
    }
    await db.sessions.delete(id);
  });
}
