import { describe, expect, it } from 'vitest';
import {
  advancePomodoro, closedMsForPhase, nextPomodoroPhase, pauseSnapshot, phaseTargetMs,
  readTimer, resumeSnapshot, summariseSessions, type TimerSnapshot,
} from '@/services/timerService';
import { DEFAULT_TIMER_PREFERENCES, type TimerMode, type TimerSession } from '@/types';

/**
 * These cover the wall-clock core of the timer: the guarantee that elapsed time
 * is derived from timestamps, so a suspended tab or a page refresh cannot cause
 * drift. Every case passes an explicit `now`; nothing reads the real clock.
 */

const T0 = new Date('2026-03-02T09:00:00').getTime();
const MIN = 60_000;

function snap(over: Partial<TimerSnapshot> = {}, mode: TimerMode = 'focus'): TimerSnapshot {
  return {
    version: 1,
    id: 'ses_1',
    mode,
    trackerId: 'trk_study',
    taskId: null,
    blockId: null,
    goalId: null,
    paperId: null,
    startedAt: T0,
    segments: [],
    runningSince: T0,
    plannedMs: 25 * MIN,
    phase: 'work',
    pomodoroCount: 0,
    interruptions: 0,
    label: 'Focus session',
    pomodoro: DEFAULT_TIMER_PREFERENCES,
    ...over,
  };
}

describe('timer core — wall-clock elapsed', () => {
  it('derives elapsed time from timestamps, not from tick counts', () => {
    // Simulates a tab suspended for 20 minutes: no ticks fired, time still real.
    const r = readTimer(snap(), T0 + 20 * MIN);
    expect(r.workMs).toBe(20 * MIN);
    expect(r.elapsedMs).toBe(20 * MIN);
    expect(r.remainingMs).toBe(5 * MIN);
    expect(r.state).toBe('running');
    expect(r.phaseComplete).toBe(false);
  });

  it('reports a paused timer as frozen no matter how much wall time passes', () => {
    const paused = pauseSnapshot(snap(), T0 + 10 * MIN);
    expect(paused.runningSince).toBeNull();
    expect(readTimer(paused, T0 + 10 * MIN).workMs).toBe(10 * MIN);
    expect(readTimer(paused, T0 + 60 * MIN).workMs).toBe(10 * MIN);
  });

  it('accumulates across pause/resume cycles without losing or double counting', () => {
    let s = snap();
    s = pauseSnapshot(s, T0 + 5 * MIN);           // 5 min worked
    s = resumeSnapshot(s, T0 + 30 * MIN);         // idle 25 min, not counted
    const r = readTimer(s, T0 + 37 * MIN);        // +7 min
    expect(r.workMs).toBe(12 * MIN);
    expect(s.interruptions).toBe(1);
  });

  it('restoring a snapshot mid-run yields the same reading as never leaving', () => {
    const original = snap();
    const restored: TimerSnapshot = JSON.parse(JSON.stringify(original));
    expect(readTimer(restored, T0 + 12 * MIN)).toEqual(readTimer(original, T0 + 12 * MIN));
  });

  it('clamps remaining time at zero and flags completion once the target passes', () => {
    const r = readTimer(snap({ plannedMs: 10 * MIN }), T0 + 14 * MIN);
    expect(r.remainingMs).toBe(0);
    expect(r.phaseComplete).toBe(true);
    expect(r.progress).toBe(1);
    // The overrun is still real work.
    expect(r.workMs).toBe(14 * MIN);
  });

  it('a stopwatch has no target, so no remaining time and no progress', () => {
    const r = readTimer(snap({ plannedMs: null }, 'stopwatch'), T0 + 3 * MIN);
    expect(r.remainingMs).toBeNull();
    expect(r.progress).toBe(0);
    expect(r.phaseComplete).toBe(false);
  });
});

describe('timer core — pomodoro phases', () => {
  const pom = (over: Partial<TimerSnapshot> = {}) => snap({ plannedMs: null, ...over }, 'pomodoro');

  it('takes each phase target from the pomodoro settings', () => {
    expect(phaseTargetMs(pom())).toBe(DEFAULT_TIMER_PREFERENCES.pomodoroWorkMinutes * MIN);
    expect(phaseTargetMs(pom({ phase: 'short_break' }))).toBe(DEFAULT_TIMER_PREFERENCES.pomodoroShortBreakMinutes * MIN);
    expect(phaseTargetMs(pom({ phase: 'long_break' }))).toBe(DEFAULT_TIMER_PREFERENCES.pomodoroLongBreakMinutes * MIN);
  });

  it('alternates work and short breaks, inserting a long break on the Nth cycle', () => {
    const every = DEFAULT_TIMER_PREFERENCES.pomodorosBeforeLongBreak; // 4
    expect(nextPomodoroPhase(pom({ pomodoroCount: 0 }))).toEqual({ phase: 'short_break', pomodoroCount: 1 });
    expect(nextPomodoroPhase(pom({ pomodoroCount: every - 1 }))).toEqual({ phase: 'long_break', pomodoroCount: every });
    expect(nextPomodoroPhase(pom({ phase: 'short_break', pomodoroCount: 2 })))
      .toEqual({ phase: 'work', pomodoroCount: 2 });
  });

  it('advancing closes the finished phase into a segment and does not count as an interruption', () => {
    const next = advancePomodoro(pom(), T0 + 25 * MIN, true);
    expect(next.phase).toBe('short_break');
    expect(next.pomodoroCount).toBe(1);
    expect(next.interruptions).toBe(0);
    expect(closedMsForPhase(next, 'work')).toBe(25 * MIN);
    expect(next.runningSince).toBe(T0 + 25 * MIN);
  });

  it('separates work time from break time across a full cycle', () => {
    let s = pom();
    s = advancePomodoro(s, T0 + 25 * MIN, true);   // work done, break running
    const r = readTimer(s, T0 + 30 * MIN);         // 5 min into the break
    expect(r.workMs).toBe(25 * MIN);
    expect(r.breakMs).toBe(5 * MIN);
    expect(r.phaseMs).toBe(5 * MIN);
    expect(r.elapsedMs).toBe(30 * MIN);
  });

  it('can advance without auto-starting the next phase', () => {
    const next = advancePomodoro(pom(), T0 + 25 * MIN, false);
    expect(next.runningSince).toBeNull();
    expect(readTimer(next, T0 + 40 * MIN).breakMs).toBe(0);
  });
});

describe('timer core — session rollups', () => {
  const session = (over: Partial<TimerSession>): TimerSession => ({
    id: 's', createdAt: T0, updatedAt: T0, mode: 'focus', taskId: null, blockId: null,
    goalId: null, trackerId: 'trk_study', paperId: null, startedAt: T0, endedAt: T0 + MIN,
    workMs: MIN, breakMs: 0, plannedMs: null, segments: [], pomodoroCount: 0,
    interruptions: 0, completed: true, date: '2026-03-02', ...over,
  });

  it('sums work, break, pomodoros and completions', () => {
    const totals = summariseSessions([
      session({ workMs: 25 * MIN, breakMs: 5 * MIN, pomodoroCount: 1 }),
      session({ workMs: 40 * MIN, completed: false }),
    ]);
    expect(totals).toEqual({ count: 2, workMs: 65 * MIN, breakMs: 5 * MIN, pomodoros: 1, completed: 1 });
  });

  it('an empty history sums to zero rather than NaN', () => {
    expect(summariseSessions([])).toEqual({ count: 0, workMs: 0, breakMs: 0, pomodoros: 0, completed: 0 });
  });
});
