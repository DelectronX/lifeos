import { describe, expect, it } from 'vitest';
import { detectAdapter, type DetectionEnvironment } from '../detect';
import { MemoryAdapter } from '../adapters/memoryAdapter';
import type { StorageAdapter } from '../types';

/**
 * Adapter selection is the one piece of this layer that decides what the user
 * experiences, so it is tested against fakes rather than real globals — no
 * network, no filesystem, no browser.
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

/**
 * A browser with the folder API but no bound-file picker, so these older
 * cases keep exercising exactly the http/fsaccess/download ladder they were
 * written for. Bound-file precedence is covered in singleFileAdapter.test.ts.
 */
const browserEnv: DetectionEnvironment = {
  protocol: 'https:',
  hasFileSystemAccess: true,
  hasSaveFilePicker: false,
  hasIndexedDb: true,
};

describe('detectAdapter', () => {
  it('prefers HTTP when the server accepts the write probe', async () => {
    const result = await detectAdapter(browserEnv, {
      makeHttp: () => fake('http', true),
      makeFsAccess: () => fake('fsaccess', true),
    });

    expect(result.adapter.id).toBe('http');
    expect(result.considered[0]).toMatchObject({ id: 'http', available: true });
  });

  it('falls back to File System Access when the server refuses PUT', async () => {
    const result = await detectAdapter(browserEnv, {
      makeHttp: () => fake('http', false),
      makeFsAccess: () => fake('fsaccess', true),
    });

    expect(result.adapter.id).toBe('fsaccess');
    expect(result.considered).toContainEqual(
      expect.objectContaining({ id: 'http', available: false }),
    );
  });

  it('falls back to manual file mode when nothing can auto-save', async () => {
    const result = await detectAdapter(browserEnv, {
      makeHttp: () => fake('http', false),
      makeFsAccess: () => fake('fsaccess', false),
      makeCache: () => new MemoryAdapter(),
    });

    expect(result.adapter.id).toBe('download');
    expect(result.adapter.capabilities.canAutoSave).toBe(false);
  });

  it('skips HTTP entirely on file:// — there is nothing to PUT to', async () => {
    const result = await detectAdapter(
      { protocol: 'file:', hasFileSystemAccess: false, hasSaveFilePicker: false, hasIndexedDb: false },
      { makeCache: () => new MemoryAdapter() },
    );

    expect(result.adapter.id).toBe('download');
    const http = result.considered.find((c) => c.id === 'http');
    expect(http).toMatchObject({ available: false });
    expect(http?.reason).toMatch(/not served over http/i);
  });

  it('explains why File System Access was unavailable', async () => {
    const result = await detectAdapter(
      { protocol: 'file:', hasFileSystemAccess: false, hasSaveFilePicker: false, hasIndexedDb: true },
      { makeCache: () => new MemoryAdapter() },
    );

    expect(result.considered.find((c) => c.id === 'fsaccess')?.reason).toMatch(
      /does not support the File System Access API/,
    );
  });

  it('honours a pinned preference over the default ranking', async () => {
    const result = await detectAdapter(browserEnv, {
      prefer: 'fsaccess',
      makeHttp: () => fake('http', true),
      makeFsAccess: () => fake('fsaccess', true),
    });

    expect(result.adapter.id).toBe('fsaccess');
  });

  it('ignores a pinned preference that cannot be satisfied', async () => {
    const result = await detectAdapter(browserEnv, {
      prefer: 'fsaccess',
      makeHttp: () => fake('http', true),
      makeFsAccess: () => fake('fsaccess', false),
    });

    expect(result.adapter.id).toBe('http');
  });

  it('manual mode is always reachable and always reports itself as available', async () => {
    const result = await detectAdapter(
      { protocol: 'file:', hasFileSystemAccess: false, hasSaveFilePicker: false, hasIndexedDb: false },
      { makeCache: () => new MemoryAdapter() },
    );
    expect(result.considered.find((c) => c.id === 'download')).toMatchObject({ available: true });
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
