import type { AdapterCapabilities, StorageAdapter } from '../types';
import { MemoryAdapter } from './memoryAdapter';

/**
 * DownloadUploadAdapter — the universal fallback, and the only mode that is
 * guaranteed to work everywhere (including `file://` with no server at all).
 *
 * Reads and writes go to a local cache (IndexedDB when available, memory
 * otherwise) so the app is fully functional and survives a refresh. What it
 * *cannot* do is put bytes on disk by itself: a webview may not write to
 * arbitrary paths without the user choosing a destination. So durability here
 * is an explicit act — the user exports `lifeos.json` (a download / share
 * sheet) and imports it back later.
 *
 * The repository treats `canAutoSave: false` as "there are unsaved changes
 * until the user exports", which is what drives the save indicator, the
 * keyboard shortcut and the before-unload prompt.
 */
export class DownloadUploadAdapter implements StorageAdapter {
  readonly id = 'download' as const;
  readonly capabilities: AdapterCapabilities = {
    canAutoSave: false,
    isPersistent: false,
    producesRealFiles: true,
    label: 'Manual file',
    description:
      'This environment will not let the app write files on its own. Your work is kept safe in a local cache, but to get a real file you must press Save — that downloads lifeos.json, which you then keep in your file manager and import again later.',
  };

  constructor(private readonly cache: StorageAdapter = new MemoryAdapter()) {}

  target(): string {
    return 'lifeos.json (downloaded by hand)';
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

/**
 * Saves text as a file the user's environment can keep. Uses the Web Share API
 * where a share sheet is the only way to reach a file manager (iOS), and falls
 * back to a plain anchor download everywhere else.
 */
export async function saveTextAsFile(filename: string, text: string): Promise<'shared' | 'downloaded'> {
  const blob = new Blob([text], { type: 'application/json' });

  const nav = globalThis.navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  if (typeof File !== 'undefined' && nav?.canShare && nav.share) {
    const file = new File([blob], filename, { type: 'application/json' });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: filename });
        return 'shared';
      } catch {
        // User dismissed the sheet, or sharing is not permitted here — fall
        // through to the download path rather than losing the click.
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
