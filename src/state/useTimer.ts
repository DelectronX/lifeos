import { useEffect } from 'react';
import { create } from 'zustand';
import {
  advancePomodoro, finishTimer, loadSnapshot, notify, pauseSnapshot, phaseTargetMs,
  readTimer, resumeSnapshot, saveSnapshot, startTimer,
  type FinishTimerResult, type StartTimerInput, type TimerReading, type TimerSnapshot,
} from '@/services/timerService';
import { toast } from '@/state/toastStore';
import { formatDuration } from '@/lib/date';
import type { PomodoroPhase } from '@/types';

/**
 * The single source of truth for the running timer.
 *
 * The store holds the SNAPSHOT (timestamps) plus a `tick` counter. The tick only
 * forces a re-render; every displayed number is recomputed from wall-clock time
 * via `readTimer`, so a throttled or suspended tab can never drift. Restoring
 * from localStorage at construction is what makes a page refresh transparent.
 */

interface TimerState {
  snapshot: TimerSnapshot | null;
  /** Incremented once a second while a timer is running; drives re-render only. */
  tick: number;
  /** Set when a planned phase has fired its completion side-effects. */
  firedForPhase: string | null;
  start: (input: StartTimerInput) => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** Ends the run, writes the session, and returns the result (null if too short). */
  stop: (options?: { completed?: boolean; completeTask?: boolean }) => Promise<FinishTimerResult | null>;
  /** Pomodoro: move to the next phase manually or on completion. */
  advance: (autoStart?: boolean) => void;
  discard: () => void;
  setTick: () => void;
  markFired: (key: string | null) => void;
  addMinutes: (minutes: number) => void;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  snapshot: loadSnapshot(),
  tick: 0,
  firedForPhase: null,

  start: async (input) => {
    const existing = get().snapshot;
    if (existing) {
      // Never silently discard real tracked time.
      await finishTimer(existing, { completed: false });
    }
    const snapshot = await startTimer(input);
    set({ snapshot, firedForPhase: null, tick: 0 });
  },

  pause: () => {
    const s = get().snapshot;
    if (!s || s.runningSince === null) return;
    const next = pauseSnapshot(s);
    saveSnapshot(next);
    set({ snapshot: next });
  },

  resume: () => {
    const s = get().snapshot;
    if (!s || s.runningSince !== null) return;
    const next = resumeSnapshot(s);
    saveSnapshot(next);
    set({ snapshot: next });
  },

  stop: async (options = {}) => {
    const s = get().snapshot;
    if (!s) return null;
    set({ snapshot: null, firedForPhase: null });
    return finishTimer(s, { completed: options.completed ?? false, completeTask: options.completeTask });
  },

  advance: (autoStart = true) => {
    const s = get().snapshot;
    if (!s || s.mode !== 'pomodoro') return;
    const next = advancePomodoro(s, Date.now(), autoStart);
    saveSnapshot(next);
    set({ snapshot: next, firedForPhase: null });
  },

  discard: () => {
    saveSnapshot(null);
    set({ snapshot: null, firedForPhase: null });
  },

  setTick: () => set((s) => ({ tick: s.tick + 1 })),
  markFired: (key) => set({ firedForPhase: key }),

  addMinutes: (minutes) => {
    const s = get().snapshot;
    if (!s || s.plannedMs === null) return;
    const next = { ...s, plannedMs: Math.max(60_000, s.plannedMs + minutes * 60_000) };
    saveSnapshot(next);
    set({ snapshot: next, firedForPhase: null });
  },
}));

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  work: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break',
};

/**
 * Drives the 1s render tick and fires phase-completion side effects exactly
 * once per phase (notification + toast + pomodoro auto-advance).
 *
 * Mounted once, high in the Focus module.
 */
export function useTimerEngine(): void {
  const snapshot = useTimerStore((s) => s.snapshot);
  const setTick = useTimerStore((s) => s.setTick);

  useEffect(() => {
    if (!snapshot || snapshot.runningSince === null) return;
    const id = window.setInterval(() => setTick(), 1000);
    return () => window.clearInterval(id);
  }, [snapshot, snapshot?.runningSince, setTick]);

  // Recompute immediately when the tab comes back — never trust background timers.
  useEffect(() => {
    const onVisible = () => setTick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [setTick]);

  const tick = useTimerStore((s) => s.tick);
  useEffect(() => {
    const state = useTimerStore.getState();
    const snap = state.snapshot;
    if (!snap || snap.runningSince === null) return;
    const target = phaseTargetMs(snap);
    if (target === null) return;
    const reading = readTimer(snap);
    if (!reading.phaseComplete) return;

    const key = `${snap.id}:${snap.phase}:${snap.pomodoroCount}`;
    if (state.firedForPhase === key) return;
    state.markFired(key);

    if (snap.mode === 'pomodoro') {
      const label = PHASE_LABEL[snap.phase];
      const isWork = snap.phase === 'work';
      const auto = snap.pomodoro.autoStartBreaks;
      notify(`${label} complete`, isWork ? 'Time for a break.' : 'Back to work.');
      toast.success(`${label} complete`, auto ? 'Next phase started.' : 'Start the next phase when ready.');
      state.advance(auto);
    } else {
      notify('Timer complete', `${formatDuration(target / 60_000)} finished.`);
      toast.success('Timer complete', 'Stop the timer to record the session.');
    }
    // `tick` is the intentional trigger: it fires once a second while running.
  }, [tick]);
}

/** Live reading of the active timer, recomputed on every tick. */
export function useTimerReading(): { snapshot: TimerSnapshot | null; reading: TimerReading | null } {
  const snapshot = useTimerStore((s) => s.snapshot);
  // Subscribing to tick is what re-renders the clock.
  useTimerStore((s) => s.tick);
  return {
    snapshot,
    reading: snapshot ? readTimer(snapshot) : null,
  };
}
