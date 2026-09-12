import { DownloadUploadAdapter } from './adapters/downloadUploadAdapter';
import { SingleFileAdapter } from './adapters/singleFileAdapter';
import { FileSystemAccessAdapter } from './adapters/fileSystemAccessAdapter';
import { HttpFileAdapter } from './adapters/httpFileAdapter';
import { IndexedDbAdapter } from './adapters/indexedDbAdapter';
import { MemoryAdapter } from './adapters/memoryAdapter';
import type { AdapterId, StorageAdapter } from './types';

/**
 * Adapter selection.
 *
 * The ranking is "most automatic and most file-like first", because the whole
 * point of this layer is that the user's data should be real files they can
 * see and sync, and they should not have to think about saving:
 *
 *   1. http       — the server accepts PUT, so files are rewritten silently.
 *   2. singlefile — the user bound ONE lifeos.json and the grant is live, so
 *                   every save overwrites that same file in place. Ranked
 *                   below http only because http needs no permission at all;
 *                   ranked above fsaccess because it is the flow the user
 *                   actually asked for ("save once, then keep pressing Save").
 *   3. fsaccess   — a folder was already granted; one file per collection.
 *   4. download   — manual mode: real files, but only when the user says Save.
 *                   This is what iOS webviews get, and it is a first-class
 *                   path, not an apology.
 *   5. memory     — nothing else works (no IndexedDB either); volatile.
 *
 * `indexeddb` is never selected as the *primary* adapter: it is the local
 * cache that backs manual mode. Choosing it as primary would put us straight
 * back in the box this change exists to get out of.
 */

export interface DetectionEnvironment {
  /** Page protocol; `file:` rules HTTP out without a round trip. */
  protocol: string;
  /** Overridden in tests to avoid touching real globals. */
  hasFileSystemAccess: boolean;
  /** `showSaveFilePicker` — present on desktop Chromium, absent on iOS. */
  hasSaveFilePicker: boolean;
  hasIndexedDb: boolean;
}

export interface DetectionResult {
  adapter: StorageAdapter;
  /** Adapters that were tried and why they were rejected, for the UI. */
  considered: { id: AdapterId; available: boolean; reason: string }[];
}

export interface DetectionOverrides {
  /** Forces a specific backend, e.g. the user pinned one in Settings. */
  prefer?: AdapterId | null;
  /** Injected factories, for tests. */
  makeHttp?: () => StorageAdapter;
  makeFsAccess?: () => StorageAdapter;
  makeSingleFile?: () => StorageAdapter;
  makeCache?: () => StorageAdapter;
}

export function readEnvironment(): DetectionEnvironment {
  const loc = (globalThis as { location?: Location }).location;
  return {
    protocol: loc?.protocol ?? 'file:',
    hasFileSystemAccess: FileSystemAccessAdapter.isAvailable(),
    hasSaveFilePicker: SingleFileAdapter.isAvailable(),
    hasIndexedDb: IndexedDbAdapter.isAvailable(),
  };
}

export async function detectAdapter(
  env: DetectionEnvironment = readEnvironment(),
  overrides: DetectionOverrides = {},
): Promise<DetectionResult> {
  const considered: DetectionResult['considered'] = [];
  const cache = () =>
    overrides.makeCache?.() ?? (env.hasIndexedDb ? new IndexedDbAdapter() : new MemoryAdapter());

  const tryAdapter = async (
    id: AdapterId,
    plausible: boolean,
    notPlausibleReason: string,
    build: () => StorageAdapter,
  ): Promise<StorageAdapter | null> => {
    if (!plausible) {
      considered.push({ id, available: false, reason: notPlausibleReason });
      return null;
    }
    const adapter = build();
    const ready = (await adapter.ensureReady?.()) ?? true;
    considered.push({
      id,
      available: ready,
      reason: ready ? 'Available.' : 'Present, but the environment refused the write test.',
    });
    return ready ? adapter : null;
  };

  const defaultOrder: AdapterId[] = ['http', 'singlefile', 'fsaccess', 'download'];
  const order: AdapterId[] = overrides.prefer
    ? [overrides.prefer, ...defaultOrder.filter((i) => i !== overrides.prefer)]
    : defaultOrder;

  for (const id of order) {
    let candidate: StorageAdapter | null = null;

    if (id === 'http') {
      candidate = await tryAdapter(
        'http',
        HttpFileAdapter.isPlausible({ protocol: env.protocol }),
        'The page is not served over http(s), so there is no server to write to.',
        () => overrides.makeHttp?.() ?? new HttpFileAdapter(),
      );
    } else if (id === 'singlefile') {
      candidate = await tryAdapter(
        'singlefile',
        env.hasSaveFilePicker,
        'This browser cannot bind a single save file — it has no File System Access API.',
        () => overrides.makeSingleFile?.() ?? new SingleFileAdapter(),
      );
      if (!candidate) {
        // ensureReady() said no for a specific, fixable reason. Replace the
        // generic "refused the write test" line with the real one.
        const entry = considered[considered.length - 1];
        if (entry?.id === 'singlefile' && env.hasSaveFilePicker) {
          entry.reason = 'Supported, but no file is bound yet (or its write permission lapsed).';
        }
      }
    } else if (id === 'fsaccess') {
      candidate = await tryAdapter(
        'fsaccess',
        env.hasFileSystemAccess,
        'This browser does not support the File System Access API.',
        () => overrides.makeFsAccess?.() ?? new FileSystemAccessAdapter(),
      );
    } else if (id === 'download') {
      candidate = new DownloadUploadAdapter(cache());
      await candidate.ensureReady?.();
      considered.push({ id: 'download', available: true, reason: 'Always available.' });
    } else if (id === 'indexeddb') {
      candidate = await tryAdapter('indexeddb', env.hasIndexedDb, 'IndexedDB is unavailable.', () => new IndexedDbAdapter());
    } else if (id === 'memory') {
      candidate = new MemoryAdapter();
      considered.push({ id: 'memory', available: true, reason: 'Always available.' });
    }

    if (candidate) return { adapter: candidate, considered };
  }

  return { adapter: new MemoryAdapter(), considered };
}
