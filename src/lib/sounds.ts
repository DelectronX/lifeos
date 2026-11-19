/**
 * Alert sounds — synthesised with Web Audio (no audio files, works offline).
 *
 * Five restrained cues: short sine/triangle tones with soft attack and an
 * exponential decay through a gentle low-pass, so they read as "chimes",
 * never beeps. Preferences live in localStorage (device-specific, like
 * volume on any OS) and are exposed for Settings and the agent API.
 *
 * Browser rules respected:
 *  - Autoplay: the AudioContext is only created/resumed after a user gesture
 *    (`unlockAudio()` is wired to the first pointer/key press). Until then
 *    `playCue` is a silent no-op that reports `'locked'`.
 *  - Not disruptive: the same cue never plays twice within 4 s, and at most
 *    one cue per 700 ms overall.
 */

export type SoundCue = 'schedule' | 'task' | 'completion' | 'achievement' | 'warning';

export const SOUND_CUES: ReadonlyArray<{ id: SoundCue; label: string; detail: string }> = [
  { id: 'schedule', label: 'Schedule reminder', detail: 'A block is about to start.' },
  { id: 'task', label: 'Task reminder', detail: 'Tasks due or a follow-up needed.' },
  { id: 'completion', label: 'Completion', detail: 'A block, task or checklist finished.' },
  { id: 'achievement', label: 'Achievement', detail: 'Level-up, achievement, milestone, payment.' },
  { id: 'warning', label: 'Warning / overdue', detail: 'Missed blocks, overdue tasks or invoices.' },
];

export interface SoundPrefs {
  enabled: boolean;
  /** 0..1 */
  volume: number;
  cues: Record<SoundCue, boolean>;
}

const KEY = 'lifeos.sounds';
export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  enabled: true,
  volume: 0.5,
  cues: { schedule: true, task: true, completion: false, achievement: true, warning: true },
};

export function readSoundPrefs(): SoundPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return DEFAULT_SOUND_PREFS;
    const p = JSON.parse(raw) as Partial<SoundPrefs>;
    return {
      enabled: p.enabled ?? DEFAULT_SOUND_PREFS.enabled,
      volume: typeof p.volume === 'number' ? Math.max(0, Math.min(1, p.volume)) : DEFAULT_SOUND_PREFS.volume,
      cues: { ...DEFAULT_SOUND_PREFS.cues, ...(p.cues ?? {}) },
    };
  } catch {
    return DEFAULT_SOUND_PREFS;
  }
}

const listeners = new Set<() => void>();
export function writeSoundPrefs(patch: Partial<SoundPrefs>): SoundPrefs {
  const next = { ...readSoundPrefs(), ...patch, cues: { ...readSoundPrefs().cues, ...(patch.cues ?? {}) } };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: keep in-memory only */ }
  for (const fn of listeners) fn();
  return next;
}
export function onSoundPrefsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
let unlocked = false;

function audioSupported(): boolean {
  return typeof window !== 'undefined' && (typeof window.AudioContext !== 'undefined' || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined');
}

/** Must run inside a user gesture. Safe to call repeatedly. */
export function unlockAudio(): void {
  if (!audioSupported()) return;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    unlocked = true;
  } catch {
    /* audio unavailable — cues stay silent */
  }
}

/** Arms `unlockAudio` on the first user gesture. Returns a cleanup. */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};
  const go = () => { unlockAudio(); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  window.addEventListener('pointerdown', go, { passive: true });
  window.addEventListener('keydown', go);
  return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
}

interface Note { f: number; t: number; d: number; type?: OscillatorType; g?: number }

/** Note lists (frequency Hz, start offset s, duration s). Tuned to sit together. */
const CUES: Record<SoundCue, Note[]> = {
  // Two-note "up next" chime: E5 → A5.
  schedule: [{ f: 659.25, t: 0, d: 0.5 }, { f: 880, t: 0.14, d: 0.7 }],
  // Single soft pluck, C6 with an octave-below body.
  task: [{ f: 1046.5, t: 0, d: 0.35, type: 'triangle' }, { f: 523.25, t: 0, d: 0.3, g: 0.35 }],
  // Quick rising major triad: G5 B5 D6.
  completion: [{ f: 783.99, t: 0, d: 0.28 }, { f: 987.77, t: 0.07, d: 0.3 }, { f: 1174.66, t: 0.14, d: 0.45 }],
  // Brighter four-note arpeggio with a soft fifth on top.
  achievement: [{ f: 523.25, t: 0, d: 0.35 }, { f: 659.25, t: 0.09, d: 0.35 }, { f: 783.99, t: 0.18, d: 0.4 }, { f: 1046.5, t: 0.27, d: 0.8 }, { f: 1567.98, t: 0.27, d: 0.8, g: 0.25 }],
  // Two descending, low, slightly hollow tones: A4 → F4.
  warning: [{ f: 440, t: 0, d: 0.32, type: 'triangle' }, { f: 349.23, t: 0.2, d: 0.5, type: 'triangle' }],
};

const lastPlayed: Partial<Record<SoundCue, number>> = {};
let lastAny = 0;
const SAME_CUE_GAP_MS = 4000;
const ANY_CUE_GAP_MS = 700;

export type PlayResult = 'played' | 'disabled' | 'muted-cue' | 'locked' | 'unsupported' | 'throttled';

/**
 * Plays a cue if enabled. `force` (used by Settings previews) bypasses the
 * per-cue toggle and throttling but still needs an unlocked audio context.
 */
export function playCue(cue: SoundCue, opts: { force?: boolean; volume?: number } = {}): PlayResult {
  const prefs = readSoundPrefs();
  if (!opts.force) {
    if (!prefs.enabled) return 'disabled';
    if (!prefs.cues[cue]) return 'muted-cue';
  }
  if (!audioSupported()) return 'unsupported';
  if (opts.force) unlockAudio();
  if (!unlocked || !ctx || ctx.state !== 'running') {
    if (ctx?.state === 'suspended' && unlocked) void ctx.resume();
    if (!ctx || ctx.state !== 'running') return 'locked';
  }
  const now = Date.now();
  if (!opts.force && ((lastPlayed[cue] && now - lastPlayed[cue]! < SAME_CUE_GAP_MS) || now - lastAny < ANY_CUE_GAP_MS)) return 'throttled';
  lastPlayed[cue] = now;
  lastAny = now;

  const volume = Math.max(0, Math.min(1, opts.volume ?? prefs.volume));
  const master = ctx.createGain();
  master.gain.value = 0.28 * volume * volume; // perceptual curve
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  lp.Q.value = 0.3;
  master.connect(lp).connect(ctx.destination);

  const t0 = ctx.currentTime + 0.01;
  for (const n of CUES[cue]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = n.type ?? 'sine';
    osc.frequency.value = n.f;
    const start = t0 + n.t;
    const peak = n.g ?? 1;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + n.d + 0.05);
  }
  return 'played';
}

/** Test seam: resets throttle state. */
export function __resetSoundThrottle(): void {
  for (const k of Object.keys(lastPlayed)) delete lastPlayed[k as SoundCue];
  lastAny = 0;
}
