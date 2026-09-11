import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { StorageRepository } from '../repository';
import { MemoryAdapter } from '../adapters/memoryAdapter';
import { makeEnvelope, serializeEnvelope } from '../envelope';
import { MANIFEST_NAME } from '../types';
import { db } from '@/db/db';
import { SCHEMA_VERSION } from '@/db/db';

/**
 * End-to-end behaviour of the repository against a fake adapter and a fake
 * IndexedDB. Nothing here touches the network or the real filesystem.
 */

async function clearWorkingSet() {
  await db.tasks.clear();
  await db.settings.clear();
  await db.goals.clear();
}

function seedFile(adapter: MemoryAdapter, collection: string, records: unknown[]) {
  return adapter.write(collection, serializeEnvelope(makeEnvelope(collection, records)));
}

describe('StorageRepository boot', () => {
  beforeEach(async () => {
    await db.open();
    await clearWorkingSet();
  });

  it('hydrates the working set from JSON files', async () => {
    const adapter = new MemoryAdapter();
    await seedFile(adapter, 'tasks', [{ id: 't1', title: 'From a file' }]);
    await seedFile(adapter, 'settings', [{ id: 'settings', theme: 'dark' }]);

    const repo = new StorageRepository();
    const state = await repo.init(adapter);

    expect(state.ready).toBe(true);
    expect(await db.tasks.get('t1')).toMatchObject({ title: 'From a file' });
    // Settings come out of the files, not localStorage.
    expect(await db.settings.get('settings')).toMatchObject({ theme: 'dark' });
  });

  it('falls back to existing IndexedDB data and marks it for a first save', async () => {
    await db.tasks.put({ id: 'legacy', title: 'Already here' } as never);

    const adapter = new MemoryAdapter(); // completely empty: no files at all
    const repo = new StorageRepository();
    const state = await repo.init(adapter);

    expect(state.migratedFromIndexedDb).toBe(true);
    // The legacy row survived — a migration must never wipe the user.
    expect(await db.tasks.get('legacy')).toBeTruthy();

    await repo.flush();
    const written = await adapter.read('tasks');
    expect(written).toContain('legacy');
  });

  it('starts clean when there is neither a file nor existing data', async () => {
    const repo = new StorageRepository();
    const state = await repo.init(new MemoryAdapter());

    expect(state.ready).toBe(true);
    expect(state.migratedFromIndexedDb).toBe(false);
    expect(state.loadWarnings).toEqual([]);
  });

  it('reports a corrupt file as a warning and keeps loading the rest', async () => {
    const adapter = new MemoryAdapter();
    await seedFile(adapter, 'tasks', [{ id: 'ok', title: 'Fine' }]);
    await adapter.write('goals', '{"format":"lifeos-collection","records":[{');

    const repo = new StorageRepository();
    const state = await repo.init(adapter);

    expect(state.loadWarnings).toHaveLength(1);
    expect(state.loadWarnings[0]).toMatch(/goals/);
    expect(await db.tasks.get('ok')).toBeTruthy();
  });

  it('migrates an older data folder on load', async () => {
    const adapter = new MemoryAdapter();
    await adapter.write(
      'blocks',
      serializeEnvelope(makeEnvelope('blocks', [{ id: 'b1', date: '2024-01-01' }], 1)),
    );

    const repo = new StorageRepository();
    await repo.init(adapter);

    expect(await db.blocks.get('b1')).toMatchObject({ recurringRuleId: null, templateId: null });
  });
});

describe('StorageRepository saving', () => {
  beforeEach(async () => {
    await db.open();
    await clearWorkingSet();
  });

  it('writes only the dirty collections plus the manifest', async () => {
    // Seed a file so the boot hydrates rather than running the one-time
    // IndexedDB migration (which deliberately marks every collection dirty).
    const adapter = new MemoryAdapter();
    await seedFile(adapter, 'tasks', []);
    const repo = new StorageRepository();
    await repo.init(adapter);
    await adapter.remove('tasks');

    await db.tasks.put({ id: 'x', title: 'New' } as never);
    await repo.flush();

    const names = await adapter.list();
    expect(names).toContain('tasks');
    expect(names).toContain(MANIFEST_NAME);
    expect(names).not.toContain('papers');

    const manifest = JSON.parse((await adapter.read(MANIFEST_NAME))!);
    expect(manifest.format).toBe('lifeos-manifest');
    expect(manifest.counts.tasks).toBe(1);
    expect(manifest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(repo.getState().status).toBe('idle');
    expect(repo.getState().lastSavedAt).toBeGreaterThan(0);
  });

  it('surfaces a write failure and keeps the data dirty for a retry', async () => {
    const adapter = new MemoryAdapter();
    const repo = new StorageRepository();
    await repo.init(adapter);

    await db.tasks.put({ id: 'y', title: 'Doomed' } as never);
    let failing = true;
    adapter.write = async (name, text) => {
      if (failing && name === 'tasks') throw new Error('server said no');
      return MemoryAdapter.prototype.write.call(adapter, name, text);
    };

    expect(await repo.flush()).toBe(false);
    expect(repo.getState().status).toBe('error');
    expect(repo.getState().lastError).toMatch(/server said no/);
    expect(repo.getState().dirtyCollections).toContain('tasks');

    failing = false;
    expect(await repo.flush()).toBe(true);
    expect(await adapter.read('tasks')).toContain('Doomed');
  });

  it('saveAll rewrites every collection', async () => {
    const adapter = new MemoryAdapter();
    const repo = new StorageRepository();
    await repo.init(adapter);

    await repo.saveAll();

    const names = await adapter.list();
    expect(names).toContain('tasks');
    expect(names).toContain('settings');
    expect(names).toContain('activities');
  });
});

describe('StorageRepository bundle transport', () => {
  beforeEach(async () => {
    await db.open();
    await clearWorkingSet();
  });

  it('exports a bundle that imports back into the same working set', async () => {
    const adapter = new MemoryAdapter();
    const repo = new StorageRepository();
    await repo.init(adapter);

    await db.tasks.put({ id: 'keep', title: 'Round trip' } as never);
    await db.settings.put({ id: 'settings', theme: 'dark' } as never);
    const text = await repo.buildBundleText();

    await clearWorkingSet();
    expect(await db.tasks.count()).toBe(0);

    const result = await repo.importBundleText(text);

    expect(result.ok).toBe(true);
    expect(await db.tasks.get('keep')).toMatchObject({ title: 'Round trip' });
    expect(await db.settings.get('settings')).toMatchObject({ theme: 'dark' });
    // Import is durable straight away, not pending a second save.
    expect(await adapter.read('tasks')).toContain('keep');
  });

  it('rejects invalid JSON with a readable message and changes nothing', async () => {
    const repo = new StorageRepository();
    await repo.init(new MemoryAdapter());
    await db.tasks.put({ id: 'safe', title: 'Untouched' } as never);

    const result = await repo.importBundleText('{ not json');

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not valid JSON/);
    expect(await db.tasks.get('safe')).toBeTruthy();
  });

  it('rejects a JSON file that is not a LifeOS export', async () => {
    const repo = new StorageRepository();
    await repo.init(new MemoryAdapter());

    const result = await repo.importBundleText('{"hello":"world"}');

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not a LifeOS export file/);
  });

  it('migrates an old bundle on import and reports what it did', async () => {
    const repo = new StorageRepository();
    await repo.init(new MemoryAdapter());

    const result = await repo.importBundleText(JSON.stringify({
      format: 'lifeos-export',
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: 1,
      tables: { blocks: [{ id: 'old', date: '2024-01-01' }] },
      counts: { blocks: 1 },
    }));

    expect(result.ok).toBe(true);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(await db.blocks.get('old')).toMatchObject({ detachedFromSeries: false });
  });
});
