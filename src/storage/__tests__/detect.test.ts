import { describe, expect, it } from 'vitest';
import { detectAdapter, type DetectionEnvironment } from '../detect';
import { MemoryAdapter } from '../adapters/memoryAdapter';
import type { StorageAdapter } from '../types';

/**
 * Adapter selection decides where the user's data lives, so it is tested
 * against fakes rather than real globals — no network, no filesystem.
 *
 * Policy: browser storage (IndexedDB) is the ONE automatic target. File-based
 * adapters are never auto-selected; they are reachable only through an
 * explicit `prefer` pin (export/import flows and tests).
 */

function fake(id: StorageAdapter['id'], ready: boolean): StorageAdapter {
  const inner = new MemoryAdapter();
  return {
    id,
    capabilities: { ...inner.capabilities, label: id },
    target: () => id,
    read: (n) => inner.read(n),
    write: (n, t) => inner.write(n, t),
    list: () => inner.list(),
    remove: (n) => inner.remove(n),
    ensureReady: async () => ready,
  };
}

const browserEnv: DetectionEnvironment = {
  protocol: 'https:',
  hasFileSystemAccess: true,
  hasSaveFilePicker: true,
  hasIndexedDb: true,
};

describe('detectAdapter', () => {
  it('always picks browser storage when IndexedDB exists, even if a server would accept writes', async () => {
    const result = await detectAdapter(browserEnv, {
      makeHttp: () => fake('http', true),
      makeFsAccess: () => fake('fsaccess', true),
      makeSingleFile: () => fake('singlefile', true),
    });

    expect(result.adapter.id).toBe('indexeddb');
    expect(result.adapter.capabilities.canAutoSave).toBe(true);
    expect(result.adapter.capabilities.isPersistent).toBe(true);
    // No file adapter was even probed.
    expect(result.considered.map((c) => c.id)).toEqual(['indexeddb']);
  });

  it('falls back to memory only when IndexedDB is unavailable', async () => {
    const result = await detectAdapter(
      { protocol: 'file:', hasFileSystemAccess: false, hasSaveFilePicker: false, hasIndexedDb: false },
      { makeCache: () => new MemoryAdapter() },
    );

    expect(result.adapter.id).toBe('memory');
    expect(result.considered.find((c) => c.id === 'indexeddb')).toMatchObject({ available: false });
  });

  it('honours an explicit pin for a file adapter', async () => {
    const result = await detectAdapter(browserEnv, {
      prefer: 'fsaccess',
      makeHttp: () => fake('http', true),
      makeFsAccess: () => fake('fsaccess', true),
    });

    expect(result.adapter.id).toBe('fsaccess');
  });

  it('returns to browser storage when a pinned adapter cannot be satisfied', async () => {
    const result = await detectAdapter(browserEnv, {
      prefer: 'fsaccess',
      makeHttp: () => fake('http', true),
      makeFsAccess: () => fake('fsaccess', false),
    });

    expect(result.adapter.id).toBe('indexeddb');
  });
});

describe('MemoryAdapter', () => {
  it('behaves as a complete adapter so it can stand in anywhere', async () => {
    const adapter = new MemoryAdapter();
    expect(await adapter.read('tasks')).toBeNull();

    await adapter.write('tasks', '[]');
    expect(await adapter.read('tasks')).toBe('[]');
    expect(await adapter.list()).toEqual(['tasks']);

    await adapter.remove('tasks');
    expect(await adapter.read('tasks')).toBeNull();
    await expect(adapter.remove('missing')).resolves.toBeUndefined();
  });

  it('is honest that it is not persistent', () => {
    expect(new MemoryAdapter().capabilities.isPersistent).toBe(false);
  });
});
