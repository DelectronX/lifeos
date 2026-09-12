import { deleteHandle, getHandle, HANDLE_KEYS, putHandle } from '../handleStore';
import type { AdapterCapabilities, StorageAdapter } from '../types';

/**
 * Minimal structural types for the File System Access API. TypeScript's DOM
 * lib does not ship these in every version, and we only use a slice of it.
 */
interface FsFileHandle {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<File>;
}
interface FsDirectoryHandle {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  values?(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }>;
}

/**
 * FileSystemAccessAdapter — real files in a real folder the user picked.
 *
 * The user chooses a folder once (`showDirectoryPicker`); the handle is kept
 * in IndexedDB, so on every later visit the app can re-acquire it and write
 * `data/tasks.json` directly into their filesystem. Browsers deliberately drop
 * the permission grant between sessions, so `ensureReady` re-requests it —
 * which must happen inside a user gesture, hence the separate
 * {@link requestAccess} entry point wired to a button.
 */
export class FileSystemAccessAdapter implements StorageAdapter {
  readonly id = 'fsaccess' as const;
  readonly capabilities: AdapterCapabilities = {
    canAutoSave: true,
    isPersistent: true,
    producesRealFiles: true,
    label: 'Local folder',
    description:
      'Every change is written into the folder you picked as ordinary JSON files. Visible to your file manager, syncable, and saved automatically.',
  };

  private dir: FsDirectoryHandle | null = null;
  private folderName = '';

  target(): string {
    return this.folderName ? `${this.folderName}/` : 'no folder chosen yet';
  }

  static isAvailable(): boolean {
    return typeof globalThis !== 'undefined' && 'showDirectoryPicker' in globalThis;
  }

  /**
   * True when a folder was picked in a previous session and the grant is still
   * live — i.e. we can go straight to reading files with no prompt.
   */
  async ensureReady(): Promise<boolean> {
    if (this.dir) return true;
    if (!FileSystemAccessAdapter.isAvailable()) return false;
    const saved = await loadHandle();
    if (!saved) return false;
    const state = (await saved.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (state !== 'granted') return false;
    this.dir = saved;
    this.folderName = saved.name;
    return true;
  }

  /** Re-prompts for permission on a stored handle. Needs a user gesture. */
  async requestPermission(): Promise<boolean> {
    const saved = this.dir ?? (await loadHandle());
    if (!saved) return false;
    const state = (await saved.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (state !== 'granted') return false;
    this.dir = saved;
    this.folderName = saved.name;
    return true;
  }

  /** Opens the folder picker. Needs a user gesture. */
  async requestAccess(): Promise<boolean> {
    if (!FileSystemAccessAdapter.isAvailable()) return false;
    try {
      const picker = (globalThis as unknown as {
        showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FsDirectoryHandle>;
      }).showDirectoryPicker;
      const handle = await picker.call(globalThis, { mode: 'readwrite' });
      const state = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
      if (state !== 'granted') return false;
      this.dir = handle;
      this.folderName = handle.name;
      await saveHandle(handle);
      return true;
    } catch {
      // The user cancelled the picker, which is not an error.
      return false;
    }
  }

  private async dataDir(): Promise<FsDirectoryHandle> {
    if (!this.dir) throw new Error('No folder has been chosen yet.');
    return this.dir.getDirectoryHandle('data', { create: true });
  }

  async read(name: string): Promise<string | null> {
    try {
      const dir = await this.dataDir();
      const file = await dir.getFileHandle(`${name}.json`);
      return await (await file.getFile()).text();
    } catch {
      return null;
    }
  }

  async write(name: string, text: string): Promise<void> {
    const dir = await this.dataDir();
    const handle = await dir.getFileHandle(`${name}.json`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async list(): Promise<string[]> {
    try {
      const dir = await this.dataDir();
      if (!dir.values) return [];
      const names: string[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
          names.push(entry.name.replace(/\.json$/, ''));
        }
      }
      return names;
    } catch {
      return [];
    }
  }

  async remove(name: string): Promise<void> {
    try {
      const dir = await this.dataDir();
      await dir.removeEntry(`${name}.json`);
    } catch { /* already gone */ }
  }
}

/* ------------------------------------------------------------------ */
/* Handle persistence — shared with the single-file adapter.           */
/* ------------------------------------------------------------------ */

async function saveHandle(handle: FsDirectoryHandle): Promise<void> {
  try {
    await putHandle(HANDLE_KEYS.directory, handle);
  } catch { /* best effort — worst case the user picks the folder again */ }
}

async function loadHandle(): Promise<FsDirectoryHandle | null> {
  return getHandle<FsDirectoryHandle>(HANDLE_KEYS.directory);
}

/** True when a folder was chosen at some point, even if permission lapsed. */
export async function hasStoredFolderHandle(): Promise<boolean> {
  return (await loadHandle()) !== null;
}

/** Forgets the chosen folder. The folder itself is untouched. */
export async function forgetFolderHandle(): Promise<void> {
  await deleteHandle(HANDLE_KEYS.directory);
}
