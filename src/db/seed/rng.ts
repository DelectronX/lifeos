/**
 * Deterministic PRNG for the demo dataset.
 *
 * The whole seeded world is generated from one 32-bit seed, so "Load demo
 * data" produces byte-identical records every time (modulo the date anchor,
 * which is deliberately relative to today). `Math.random` is never used
 * anywhere in src/db/seed/** — that is the point.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Uniform choice from a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** `count` distinct items, or the whole list when it is shorter. */
  sample<T>(items: readonly T[], count: number): T[];
  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
  /** Approximately normal sample, clamped to [min, max]. */
  gaussian(mean: number, stdDev: number, min: number, max: number): number;
  /** Weighted choice: entries are [value, weight] with weight > 0. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
}

/** mulberry32 — small, fast, well-distributed, and trivially reproducible. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)] as never,
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i] as never;
        out[i] = out[j] as never;
        out[j] = a;
      }
      return out;
    },
    sample: (items, count) => rng.shuffle(items).slice(0, Math.max(0, count)),
    gaussian: (mean, stdDev, min, max) => {
      // Irwin–Hall approximation: enough for plausible-looking data and far
      // cheaper (and more stable) than Box–Muller with a clamped tail.
      const sum = next() + next() + next() + next() + next() + next();
      const value = mean + (sum - 3) * stdDev;
      return Math.min(max, Math.max(min, value));
    },
    weighted: (entries) => {
      const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= Math.max(0, weight);
        if (roll <= 0) return value;
      }
      return entries[entries.length - 1]![0];
    },
  };

  return rng;
}

/** Default seed. Chosen once; changing it reshuffles the entire dataset. */
export const DEMO_SEED = 20260211;
