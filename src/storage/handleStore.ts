/**
 * Persistence for File System Access handles.
 *
 * Handles are structured-cloneable, so IndexedDB can hold them across
 * sessions (localStorage cannot — it is strings only). Keeping this in one
 * place means the directory mode and the single-file mode cannot drift apart
 * on how a handle is stored, and tests can swap the whole thing out.
 */

const HANDLE_DB = 'lifeos-fs';
const HANDLE_STORE = 'handles';

/** Keys in use. `dataDir` predates this module and must keep its name. */
export const HANDLE_KEYS = {
  directory: 'dataDir',
  bundleFile: 'bundleFile',
} as const;

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putHandle(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getHandle<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openHandleDb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const request = tx.objectStore(HANDLE_STORE).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteHandle(key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* nothing to forget */ }
}
