import { DownloadUploadAdapter } from './adapters/downloadUploadAdapter';
import { FileSystemAccessAdapter } from './adapters/fileSystemAccessAdapter';
import { HttpFileAdapter } from './adapters/httpFileAdapter';
import { IndexedDbAdapter } from './adapters/indexedDbAdapter';
import { MemoryAdapter } from './adapters/memoryAdapter';
import type { AdapterId, StorageAdapter } from './types';

/**
 * Adapter selection.
 *
 * The ranking is "most automatic and most file-like first", because the whole
 * point of this change is that the user's data should be real files they can
 * see and sync, and they should not have to think about saving:
 *
 *   1. http      — the server accepts PUT, so files are rewritten silently.
 *   2. fsaccess  — a folder was already granted, so files are written silently.
 *   3. download  — manual mode: real files, but only when the user says Save.
 *   4. memory    — nothing else works (no IndexedDB either); volatile.
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
  makeCache?: () => StorageAdapter;
}

export function readEnvironment(): DetectionEnvironment {
  const loc = (globalThis as { location?: Location }).location;
  return {
    protocol: loc?.protocol ?? 'file:',
    hasFileSystemAccess: FileSystemAccessAdapter.isAvailable(),
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

  const order: AdapterId[] = overrides.prefer
    ? [overrides.prefer, ...(['http', 'fsaccess', 'download'] as AdapterId[]).filter((i) => i !== overrides.prefer)]
    : ['http', 'fsaccess', 'download'];

  for (const id of order) {
    let candidate: StorageAdapter | null = null;

    if (id === 'http') {
      candidate = await tryAdapter(
        'http',
        HttpFileAdapter.isPlausible({ protocol: env.protocol }),
        'The page is not served over http(s), so there is no server to write to.',
        () => overrides.makeHttp?.() ?? new HttpFileAdapter(),
      );
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
