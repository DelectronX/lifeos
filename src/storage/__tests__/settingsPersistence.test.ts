import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { StorageRepository } from '../repository';
import { MemoryAdapter } from '../adapters/memoryAdapter';
import { makeEnvelope, parseEnvelope, serializeEnvelope } from '../envelope';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import {
  flushUiState, getUiState, hydrateUiState, resetUiStateForTests, setUiState,
} from '@/services/uiStateStore';

/**
 * Settings persistence, end to end.
 *
 * The hard requirement this file exists for: the user opens the app from an
 * iOS file manager, so EVERY preference has to end up inside
 * `data/settings.json`. Nothing may be stranded in localStorage except the
 * theme's pre-paint cache. These tests read the actual bytes written by the
 * adapter, not the in-memory state, because only the bytes are portable.
 */

function settingsRecords(adapter: MemoryAdapter) {
  return adapter.read('settings').then((text) => {
    const parsed = parseEnvelope<Record<string, unknown>>(text, 'settings');
    expect(parsed.error).toBeNull();
    return parsed.envelope?.records ?? [];
  });
}

describe('settings live in settings.json', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) {
      const table = db.table(name);
      await table.clear();
    }
    resetUiStateForTests();
  });

  it('writes UI state into the settings collection file', async () => {
    const adapter = new MemoryAdapter();
    const repo = new StorageRepository();
    await repo.init(adapter);

    setUiState('rail.collapsed', true);
    setUiState('palette.recents', ['tasks.new']);
    await repo.flush();

    const [row] = await settingsRecords(adapter);
    expect(row).toBeTruthy();
    expect((row.uiState as Record<string, unknown>)['rail.collapsed']).toBe(true);
    expect((row.uiState as Record<string, unknown>)['palette.recents']).toEqual(['tasks.new']);
  });

  it('rehydrates UI state from the files on the next boot', async () => {
    const adapter = new MemoryAdapter();
    await adapter.write(
      'settings',
      serializeEnvelope(
        makeEnvelope('settings', [
          { id: 'settings', theme: 'light', uiState: { 'rail.collapsed': true } },
        ]),
      ),
    );

    resetUiStateForTests();
    const repo = new StorageRepository();
    await repo.init(adapter);

    // Synchronous read works right after boot — that is what lets a zustand
    // initialiser and a useState default see the persisted value.
    expect(getUiState('rail.collapsed', false)).toBe(true);
    expect((await db.settings.get('settings'))?.theme).toBe('light');
  });

  it('keeps a debounced UI-state write from being lost by an export', async () => {
    const adapter = new MemoryAdapter();
    const repo = new StorageRepository();
    await repo.init(adapter);

    setUiState('timer.active', { id: 's1', mode: 'focus' });
    // No flushUiState() here on purpose: buildBundleText must settle it.
    const text = await repo.buildBundleText();
    expect(text).toContain('timer.active');
  });

  it('survives a settings row that does not exist yet', async () => {
    resetUiStateForTests();
    await hydrateUiState();
    setUiState('maintenance.lastRun', '2026-01-01');
    await flushUiState();
    expect((await db.settings.get('settings'))?.uiState?.['maintenance.lastRun']).toBe('2026-01-01');
  });
});

describe('mutations in every module mark their collection dirty', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) await db.table(name).clear();
    resetUiStateForTests();
  });

  it('persists a record from each entity type through to a file', async () => {
    const adapter = new MemoryAdapter();
    const repo = new StorageRepository();
    await repo.init(adapter);

    const samples: [string, Record<string, unknown>][] = [
      ['tasks', { id: 'task-1', title: 'A task', status: 'todo' }],
      ['goals', { id: 'goal-1', title: 'A goal', status: 'active' }],
      ['sessions', { id: 'sess-1', mode: 'focus', date: '2026-01-01' }],
      ['papers', { id: 'paper-1', title: 'A paper', date: '2026-01-01' }],
      ['revisionEntries', { id: 'rev-1', date: '2026-01-01', status: 'due' }],
      ['rewards', { id: 'reward-1', name: 'A reward' }],
      ['achievements', { id: 'ach-1', key: 'first-task' }],
      ['habits', { id: 'habit-1', name: 'A habit' }],
      ['resources', { id: 'res-1', title: 'A resource' }],
      ['xp', { id: 'xp-1', amount: 10, date: '2026-01-01', reason: 'task' }],
      ['activities', { id: 'act-1', type: 'task_completed', date: '2026-01-01' }],
      ['blocks', { id: 'blk-1', date: '2026-01-01', start: '09:00', end: '10:00' }],
    ];

    for (const [name, record] of samples) {
      await db.table(name).put(record as never);
    }

    // Every touched collection must be dirty before the write.
    const dirty = repo.getState().dirtyCollections;
    for (const [name] of samples) expect(dirty).toContain(name);

    expect(await repo.flush()).toBe(true);
    expect(repo.getState().dirtyCollections).toEqual([]);

    // And every one of them must be readable back out of its own file.
    for (const [name, record] of samples) {
      const parsed = parseEnvelope<Record<string, unknown>>(await adapter.read(name), name);
      expect(parsed.error, `${name} produced a parse error`).toBeNull();
      expect(parsed.envelope?.records, `${name} did not reach its file`)
        .toContainEqual(expect.objectContaining({ id: record.id }));
    }

    const counts = await repo.getCollectionCounts();
    for (const [name] of samples) {
      expect(counts.find((c) => c.name === name)?.count).toBe(1);
    }
  });

  it('marks a collection dirty again when it is edited during a flush', async () => {
    const adapter = new MemoryAdapter();
    const repo = new StorageRepository();
    await repo.init(adapter);

    await db.tasks.put({ id: 't1', title: 'one' } as never);
    const flushing = repo.flush();
    await db.tasks.put({ id: 't2', title: 'two' } as never);
    await flushing;

    // t2 landed mid-write, so it must still be pending rather than silently
    // dropped; a second flush is what puts it on disk.
    await repo.flush();
    const parsed = parseEnvelope<Record<string, unknown>>(await adapter.read('tasks'), 'tasks');
    expect(parsed.envelope?.records).toHaveLength(2);
  });
});
