import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SingleFileAdapter, type FsBoundFileHandle, type FsWritableStream, type SaveFilePicker,
} from '../adapters/singleFileAdapter';
import { makeEnvelope, serializeEnvelope } from '../envelope';
import { detectAdapter, type DetectionEnvironment } from '../detect';
import { MemoryAdapter } from '../adapters/memoryAdapter';
import type { StorageAdapter } from '../types';

/**
 * The bound save target, tested against fakes.
 *
 * No real filesystem, no real picker, no IndexedDB: every seam the adapter
 * uses (`showSaveFilePicker`, the handle store) is injected, so these tests
 * cover the behaviour the user actually experiences — bind once, overwrite
 * forever, and a clear recoverable state for every way that can go wrong.
 */

interface FakeFile {
  name: string;
  contents: string;
  permission: PermissionState;
  /** Simulates the file being moved or deleted behind the app's back. */
  missing?: boolean;
  writes: number;
}

function fakeHandle(file: FakeFile): FsBoundFileHandle {
  return {
    get name() { return file.name; },
    async createWritable(): Promise<FsWritableStream> {
      if (file.permission !== 'granted') throw new Error('NotAllowedError: permission');
      if (file.missing) throw new Error('NotFoundError: gone');
      let buffer = '';
      return {
        async write(data: string) { buffer += data; },
        async close() { file.contents = buffer; file.writes++; },
      };
    },
    async getFile() {
      if (file.missing) throw new Error('NotFoundError: gone');
      return { text: async () => file.contents };
    },
    async queryPermission() { return file.permission; },
    async requestPermission() {
      if (file.permission === 'prompt') file.permission = 'granted';
      return file.permission;
    },
  };
}

function bundleText(tasks: unknown[]): string {
  return JSON.stringify({
    format: 'lifeos-export',
    schemaVersion: 1,
    appVersion: '1.0.0',
    exportedAt: 1,
    tables: { tasks },
    counts: { tasks: tasks.length },
  });
}

/** An adapter wired to a fake picker and an in-memory handle store. */
function makeAdapter(file: FakeFile, options: { prebound?: boolean; picker?: SaveFilePicker | null } = {}) {
  const handle = fakeHandle(file);
  let stored: FsBoundFileHandle | null = options.prebound ? handle : null;
  const picker = options.picker !== undefined
    ? options.picker
    : (vi.fn(async () => handle) as unknown as SaveFilePicker);
  const adapter = new SingleFileAdapter({
    picker,
    loadHandle: async () => stored,
    saveHandle: async (h) => { stored = h; },
    forgetHandle: async () => { stored = null; },
  });
  return { adapter, picker, handle, getStored: () => stored };
}

let file: FakeFile;

beforeEach(() => {
  file = { name: 'lifeos.json', contents: bundleText([]), permission: 'granted', writes: 0 };
});

describe('SingleFileAdapter — binding', () => {
  it('binds the picked file and persists the handle for next time', async () => {
    const { adapter, picker, getStored } = makeAdapter(file);

    const result = await adapter.bind();

    expect(result.cancelled).toBe(false);
    expect(result.status).toBe('granted');
    expect(result.filename).toBe('lifeos.json');
    expect(picker).toHaveBeenCalledOnce();
    expect(getStored()).not.toBeNull();
  });

  it('overwrites the SAME file on every later write — no picker, no duplicate', async () => {
    const { adapter, picker } = makeAdapter(file);
    await adapter.bind();

    await adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', [{ id: 'a' }])));
    await adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', [{ id: 'a' }, { id: 'b' }])));

    // Picked once, ever.
    expect(picker).toHaveBeenCalledOnce();
    expect(file.writes).toBeGreaterThanOrEqual(2);
    const parsed = JSON.parse(file.contents) as { tables: { tasks: { id: string }[] } };
    expect(parsed.tables.tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('a cancelled picker keeps the previous binding and is not an error', async () => {
    const { adapter } = makeAdapter(file);
    await adapter.bind();

    const cancelling = new SingleFileAdapter({
      picker: (async () => { throw new Error('AbortError'); }) as unknown as SaveFilePicker,
      loadHandle: async () => fakeHandle(file),
      saveHandle: async () => {},
      forgetHandle: async () => {},
    });
    await cancelling.ensureReady();
    const result = await cancelling.bind();

    expect(result.cancelled).toBe(true);
    expect(result.filename).toBe('lifeos.json');
  });

  it('rebinding to a different file redirects every later save', async () => {
    const other: FakeFile = { name: 'other.json', contents: bundleText([]), permission: 'granted', writes: 0 };
    const first = fakeHandle(file);
    const second = fakeHandle(other);
    const queue = [first, second];
    const adapter = new SingleFileAdapter({
      picker: (async () => queue.shift() as FsBoundFileHandle) as unknown as SaveFilePicker,
      loadHandle: async () => null,
      saveHandle: async () => {},
      forgetHandle: async () => {},
    });

    await adapter.bind();
    await adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', [{ id: 'a' }])));
    await adapter.bind();
    await adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', [{ id: 'z' }])));

    expect(adapter.info().filename).toBe('other.json');
    expect(JSON.parse(other.contents).tables.tasks).toEqual([{ id: 'z' }]);
    // The old file keeps whatever it had; nothing was written to it after the rebind.
    expect(JSON.parse(file.contents).tables.tasks).toEqual([{ id: 'a' }]);
  });

  it('unbinding forgets the handle and leaves the file alone', async () => {
    const { adapter, getStored } = makeAdapter(file);
    await adapter.bind();
    await adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', [{ id: 'a' }])));
    const before = file.contents;

    const info = await adapter.unbind();

    expect(info.status).toBe('unbound');
    expect(getStored()).toBeNull();
    expect(file.contents).toBe(before);
  });
});

describe('SingleFileAdapter — permission lifecycle', () => {
  it('reconnects silently at boot when the grant is still live', async () => {
    const { adapter, picker } = makeAdapter(file, { prebound: true });

    expect(await adapter.ensureReady()).toBe(true);
    expect(adapter.info().status).toBe('granted');
    expect(picker).not.toHaveBeenCalled();
  });

  it("reports 'prompt' rather than failing silently when the grant lapsed", async () => {
    file.permission = 'prompt';
    const { adapter } = makeAdapter(file, { prebound: true });

    expect(await adapter.ensureReady()).toBe(false);
    const info = adapter.info();
    expect(info.status).toBe('prompt');
    expect(info.filename).toBe('lifeos.json');
    expect(info.message).toMatch(/Reconnect file/i);
  });

  it('reconnect() restores the grant and writing works again', async () => {
    file.permission = 'prompt';
    const { adapter } = makeAdapter(file, { prebound: true });
    await adapter.ensureReady();

    const info = await adapter.reconnect();

    expect(info.status).toBe('granted');
    await adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', [{ id: 'a' }])));
    expect(JSON.parse(file.contents).tables.tasks).toEqual([{ id: 'a' }]);
  });

  it('a denied grant is reported as denied with an actionable message', async () => {
    file.permission = 'denied';
    const { adapter } = makeAdapter(file, { prebound: true });

    expect(await adapter.ensureReady()).toBe(false);
    expect(adapter.info().status).toBe('denied');
    expect(adapter.info().message).toMatch(/refused/i);
    await expect(
      adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', []))),
    ).rejects.toThrow(/refused|Reconnect/i);
  });

  it('writing with a lapsed grant throws a message that names the fix', async () => {
    file.permission = 'prompt';
    const { adapter } = makeAdapter(file, { prebound: true });
    await adapter.ensureReady();

    await expect(
      adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', []))),
    ).rejects.toThrow(/Reconnect file/i);
  });
});

describe('SingleFileAdapter — handle missing', () => {
  it('reports the file as missing and says to pick it again', async () => {
    const { adapter } = makeAdapter(file, { prebound: true });
    await adapter.ensureReady();
    file.missing = true;

    await expect(
      adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', [{ id: 'a' }]))),
    ).rejects.toThrow(/moved or deleted|could not be opened/i);
    expect(adapter.info().status).toBe('missing');
  });

  it('a missing file does not break boot — read() returns null, not a crash', async () => {
    const { adapter } = makeAdapter(file, { prebound: true });
    await adapter.ensureReady();
    file.missing = true;

    await expect(adapter.read('tasks')).resolves.toBeNull();
    await expect(adapter.list()).resolves.toEqual([]);
  });

  it('refuses to write when nothing is bound, and says how to bind', async () => {
    const { adapter } = makeAdapter(file);

    await expect(
      adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', []))),
    ).rejects.toThrow(/No save file is bound/i);
  });
});

describe('SingleFileAdapter — reading the bound file', () => {
  it('serves collections out of the bound bundle as envelopes', async () => {
    file.contents = bundleText([{ id: 'a' }, { id: 'b' }]);
    const { adapter } = makeAdapter(file, { prebound: true });
    await adapter.ensureReady();

    const text = await adapter.read('tasks');
    expect(text).not.toBeNull();
    expect(JSON.parse(text as string).records).toHaveLength(2);
    expect(await adapter.read('goals')).toBeNull();
    expect(await adapter.list()).toEqual(['tasks']);
  });

  it('treats an unrelated or corrupt JSON file as empty rather than crashing', async () => {
    file.contents = '{"not":"a lifeos bundle"}';
    const { adapter } = makeAdapter(file, { prebound: true });
    await adapter.ensureReady();

    expect(await adapter.read('tasks')).toBeNull();
    await adapter.write('tasks', serializeEnvelope(makeEnvelope('tasks', [{ id: 'a' }])));
    expect(JSON.parse(file.contents).format).toBe('lifeos-export');
  });

  it('is unavailable, and honest about it, without a picker', async () => {
    const { adapter } = makeAdapter(file, { picker: null });

    expect(await adapter.ensureReady()).toBe(false);
    expect(adapter.info().status).toBe('unsupported');
    expect(adapter.info().message).toMatch(/no File System Access API/i);
  });
});

/* ------------------------------------------------------------------ */
/* Adapter selection precedence                                        */
/* ------------------------------------------------------------------ */

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

const desktop: DetectionEnvironment = {
  protocol: 'https:',
  hasFileSystemAccess: true,
  hasSaveFilePicker: true,
  hasIndexedDb: true,
};

const iosWebview: DetectionEnvironment = {
  protocol: 'file:',
  hasFileSystemAccess: false,
  hasSaveFilePicker: false,
  hasIndexedDb: true,
};

describe('detectAdapter — bound file precedence', () => {
  it('a bound file beats the folder mode and the download fallback', async () => {
    const result = await detectAdapter(desktop, {
      makeHttp: () => fake('http', false),
      makeSingleFile: () => fake('singlefile', true),
      makeFsAccess: () => fake('fsaccess', true),
    });

    expect(result.adapter.id).toBe('singlefile');
  });

  it('a working HTTP server still wins — it needs no permission at all', async () => {
    const result = await detectAdapter(desktop, {
      makeHttp: () => fake('http', true),
      makeSingleFile: () => fake('singlefile', true),
    });

    expect(result.adapter.id).toBe('http');
  });

  it('falls through to the folder mode when no file is bound yet', async () => {
    const result = await detectAdapter(desktop, {
      makeHttp: () => fake('http', false),
      makeSingleFile: () => fake('singlefile', false),
      makeFsAccess: () => fake('fsaccess', true),
    });

    expect(result.adapter.id).toBe('fsaccess');
    expect(result.considered.find((c) => c.id === 'singlefile')?.reason).toMatch(/no file is bound yet/i);
  });

  it('the iOS webview lands in manual mode, and is told why', async () => {
    const result = await detectAdapter(iosWebview, { makeCache: () => new MemoryAdapter() });

    expect(result.adapter.id).toBe('download');
    expect(result.adapter.capabilities.canAutoSave).toBe(false);
    expect(result.considered.find((c) => c.id === 'singlefile')?.reason).toMatch(
      /cannot bind a single save file/i,
    );
  });

  it('honours a pinned singlefile preference over HTTP', async () => {
    const result = await detectAdapter(desktop, {
      prefer: 'singlefile',
      makeHttp: () => fake('http', true),
      makeSingleFile: () => fake('singlefile', true),
    });

    expect(result.adapter.id).toBe('singlefile');
  });
});
