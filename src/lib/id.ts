/**
 * Monotonic, sortable, collision-resistant ids that work offline with no deps.
 * Format: <base36 time><random> — lexicographically sortable by creation time.
 */
let counter = Math.floor(Math.random() * 4096);

export function newId(prefix = ''): string {
  counter = (counter + 1) % 0x10000;
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = Math.floor(Math.random() * 0x100000000).toString(36).padStart(7, '0');
  const seq = counter.toString(36).padStart(4, '0');
  const id = `${time}${seq}${rand}`;
  return prefix ? `${prefix}_${id}` : id;
}

/** Stable hash for dedupe keys / deterministic colour picking. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
