import { BUNDLE_FILENAME, type AdapterCapabilities, type StorageAdapter } from '../types';
import { MemoryAdapter } from './memoryAdapter';

/**
 * DownloadUploadAdapter — the universal fallback, and the mode the target
 * device actually runs in.
 *
 * The confirmed environment is an iOS FTP client's sandboxed `file://`
 * webview: no HTTP server to PUT to, and no File System Access API, so
 * nothing can write to disk on its own. Durability there is an explicit act —
 * the user presses Save, the share sheet (or a download) hands them
 * `lifeos.json`, and they replace the copy in their file manager.
 *
 * Two deliberate choices make that survivable rather than chaotic:
 *
 *  - the filename is ALWAYS `lifeos.json`, never timestamped or numbered, so
 *    the file manager offers "Replace" instead of accumulating
 *    `lifeos (1).json`;
 *  - reads and writes go to a local cache (IndexedDB when available, memory
 *    otherwise) so the app is fully functional and survives a refresh between
 *    manual saves.
 *
 * The repository treats `canAutoSave: false` as "there are unsaved changes
 * until the user saves", which drives the save indicator, Ctrl/Cmd+S and the
 * before-unload prompt.
 */
export class DownloadUploadAdapter implements StorageAdapter {
  readonly id = 'download' as const;
  readonly capabilities: AdapterCapabilities = {
    canAutoSave: false,
    isPersistent: false,
    producesRealFiles: true,
    label: 'Manual file',
    description:
      `This environment cannot write files on its own. Your work is kept in a local cache so a refresh will not lose it, but to get a real file you press Save: that hands you ${BUNDLE_FILENAME} — always that exact name — and you choose Replace over the copy in your file manager.`,
  };

  constructor(private readonly cache: StorageAdapter = new MemoryAdapter()) {}

  target(): string {
    return `${BUNDLE_FILENAME} (saved by hand, always the same filename)`;
  }

  async ensureReady(): Promise<boolean> {
    return (await this.cache.ensureReady?.()) ?? true;
  }

  read(name: string): Promise<string | null> {
    return this.cache.read(name);
  }

  write(name: string, text: string): Promise<void> {
    return this.cache.write(name, text);
  }

  list(): Promise<string[]> {
    return this.cache.list();
  }

  remove(name: string): Promise<void> {
    return this.cache.remove(name);
  }
}

/** How the bytes actually reached the user. */
export type SaveOutcome = 'shared' | 'downloaded';

/** True when the Web Share API can hand this environment a real file. */
export function canShareFiles(): boolean {
  if (typeof File === 'undefined') return false;
  const nav = globalThis.navigator as (Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[] }) => Promise<void>;
  }) | undefined;
  if (!nav?.canShare || !nav.share) return false;
  try {
    return nav.canShare({ files: [new File([''], BUNDLE_FILENAME, { type: 'application/json' })] });
  } catch {
    return false;
  }
}

/**
 * Saves text as a file the user's environment can keep.
 *
 * The Web Share API is tried FIRST on purpose: on iOS the share sheet is the
 * only route that reaches a file manager and lets the user save straight back
 * over the existing file. An anchor download is the fallback everywhere else.
 *
 * `filename` defaults to the stable bundle name and callers should leave it
 * alone — a timestamped name is exactly the duplicate-accumulating behaviour
 * this exists to avoid.
 */
export async function saveTextAsFile(filename: string, text: string): Promise<SaveOutcome> {
  const blob = new Blob([text], { type: 'application/json' });

  const nav = globalThis.navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  if (typeof File !== 'undefined' && nav?.canShare && nav.share) {
    const file = new File([blob], filename, { type: 'application/json' });
    let shareable = false;
    try {
      shareable = nav.canShare({ files: [file] });
    } catch {
      shareable = false;
    }
    if (shareable) {
      try {
        await nav.share({ files: [file], title: filename });
        return 'shared';
      } catch {
        // Sheet dismissed, or sharing not permitted here — fall through to the
        // download path rather than losing the click.
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

/**
 * Asks the browser to keep this origin's storage rather than evicting it.
 *
 * Matters most exactly where it is least reliable: iOS evicts data for sites
 * that are not on the Home Screen after a period of disuse, which would take
 * the local cache with it. Returns what the browser actually decided so the
 * UI can tell the truth instead of reassuring the user.
 */
export async function requestPersistentStorage(): Promise<'persisted' | 'denied' | 'unsupported'> {
  const storageManager = (globalThis.navigator as Navigator | undefined)?.storage as
    | { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> }
    | undefined;
  if (!storageManager?.persist) return 'unsupported';
  try {
    if (await storageManager.persisted?.()) return 'persisted';
    return (await storageManager.persist()) ? 'persisted' : 'denied';
  } catch {
    return 'unsupported';
  }
}
