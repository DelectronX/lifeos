import type { AdapterCapabilities, StorageAdapter } from '../types';

const DB_NAME = 'lifeos-files';
const STORE = 'files';

/**
 * IndexedDbAdapter — a local mirror of the JSON files.
 *
 * This is NOT the source of truth any more; it is a cache that makes the app
 * usable offline and makes a reload instant even when the real target (a
 * WebDAV server, a picked folder) is slow or temporarily unavailable. It also
 * backstops manual-file mode: your unsaved work survives a refresh even though
 * you have not exported a bundle yet.
 *
 * Deliberately raw IDB rather than Dexie: it stores opaque text keyed by
 * collection name and must not participate in the app's schema versioning.
 */
export class IndexedDbAdapter implements StorageAdapter {
  readonly id = 'indexeddb' as const;
  readonly capabilities: AdapterCapabilities = {
    canAutoSave: true,
    isPersistent: true,
    producesRealFiles: false,
    label: 'Browser storage',
    description:
      'Saved automatically inside this app\'s private browser storage. Reliable, but the files are not visible to your file manager — export a bundle to get a real file.',
  };

  private opening: Promise<IDBDatabase> | null = null;

  target(): string {
    return `IndexedDB (${DB_NAME})`;
  }

  static isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    if (this.opening) return this.opening;
    this.opening = openWithRetry().catch((e) => {
      this.opening = null; // allow a later retry instead of caching the failure
      throw e;
    });
    return this.opening;
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Local cache write failed.'));
    });
  }

  async ensureReady(): Promise<boolean> {
    if (!IndexedDbAdapter.isAvailable()) return false;
    try {
      await this.open();
      return true;
    } catch {
      return false;
    }
  }

  async read(name: string): Promise<string | null> {
    const value = await this.tx<unknown>('readonly', (s) => s.get(name) as IDBRequest<unknown>);
    return typeof value === 'string' ? value : null;
  }

  async write(name: string, text: string): Promise<void> {
    await this.tx('readwrite', (s) => s.put(text, name) as IDBRequest<IDBValidKey>);
  }

  async list(): Promise<string[]> {
    const keys = await this.tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
    return keys.map(String);
  }

  async remove(name: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(name) as IDBRequest<undefined>);
  }
}

/**
 * WebKit (iPad/iPhone Safari, especially Home Screen apps) sometimes never
 * answers the FIRST indexedDB.open() of a session: no success, no error, the
 * app just waits forever on a black screen. Each attempt is time-boxed; on a
 * stall we "wake" IndexedDB by touching a throwaway database and try again.
 */
function openOnce(timeoutMs: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('timeout'));
    }, timeoutMs);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) { request.result.close(); return; }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error('Could not open the local cache.'));
    };
  });
}

function wakeIndexedDb(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const probe = indexedDB.open('lifeos-wake');
      probe.onsuccess = () => { probe.result.close(); resolve(); };
      probe.onerror = () => resolve();
      setTimeout(resolve, 500);
    } catch {
      resolve();
    }
  });
}

async function openWithRetry(): Promise<IDBDatabase> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await openOnce(2500);
    } catch (e) {
      last = e;
      if (e instanceof Error && e.message !== 'timeout') throw e;
      await wakeIndexedDb();
    }
  }
  throw new Error(`The browser storage did not respond (${last instanceof Error ? last.message : 'unknown'}). Close LifeOS completely and open it again.`);
}
