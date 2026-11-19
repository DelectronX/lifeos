import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// Node >= 25 ships an experimental global `localStorage` that is undefined
// unless started with --localstorage-file, and it shadows jsdom's. Provide a
// spec-shaped in-memory Storage for tests when the global is unusable.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage?.clear !== 'function') {
  const data = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true, writable: true });
}
