import { describe, expect, it } from 'vitest';
import { bundleToEnvelopes, collectionsToBundle } from '../bundle';
import { parseEnvelope, serializeEnvelope } from '../envelope';
import { SCHEMA_VERSION } from '@/db/db';
import type { ExportBundle } from '@/services/migrationService';

/**
 * The folder layout and the transport bundle are two views of one dataset.
 * These tests pin the conversion both ways, including the schema migration
 * that lets a data folder written by an older build still load.
 */

function oldBundle(schemaVersion: number): ExportBundle {
  return {
    format: 'lifeos-export',
    schemaVersion,
    appVersion: '0.9.0',
    exportedAt: 1,
    tables: {
      tasks: [{ id: 't1', title: 'Old task' }],
      blocks: [{ id: 'b1', date: '2024-01-01' }],
      resources: [{ id: 'r1', title: 'A link' }],
      attachments: [{ id: 'a1', resourceId: 'r1' }],
    },
    counts: { tasks: 1, blocks: 1, resources: 1, attachments: 1 },
  };
}

describe('collectionsToBundle', () => {
  it('produces a valid export bundle with counts derived from the data', () => {
    const bundle = collectionsToBundle({ tasks: [{ id: 'a' }, { id: 'b' }], goals: [] }, 42);

    expect(bundle.format).toBe('lifeos-export');
    expect(bundle.schemaVersion).toBe(SCHEMA_VERSION);
    expect(bundle.exportedAt).toBe(42);
    expect(bundle.counts).toEqual({ tasks: 2, goals: 0 });
  });

  it('does not alias the caller\'s collection map', () => {
    const collections = { tasks: [{ id: 'a' }] };
    const bundle = collectionsToBundle(collections);
    bundle.tables.goals = [];
    expect('goals' in collections).toBe(false);
  });
});

describe('bundleToEnvelopes', () => {
  it('migrates a v1 bundle all the way to the current schema', () => {
    const { envelopes, applied } = bundleToEnvelopes(oldBundle(1), 777);

    expect(applied.length).toBeGreaterThanOrEqual(2);
    expect(applied[0]).toMatch(/v1 → v2/);

    for (const envelope of envelopes) {
      expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
      expect(envelope.savedAt).toBe(777);
      expect(envelope.format).toBe('lifeos-collection');
    }

    const blocks = envelopes.find((e) => e.collection === 'blocks');
    // v1 -> v2 backfills the series links so old rows are still indexable.
    expect(blocks?.records[0]).toMatchObject({
      id: 'b1',
      recurringRuleId: null,
      templateId: null,
      detachedFromSeries: false,
    });

    const resources = envelopes.find((e) => e.collection === 'resources');
    // v2 -> v3 backfills the multi-entry reverse-link arrays.
    expect(resources?.records[0]).toMatchObject({ taskIds: [], blockIds: [], goalIds: [] });
  });

  it('applies no migration to a bundle already at the current version', () => {
    const { applied } = bundleToEnvelopes(oldBundle(SCHEMA_VERSION));
    expect(applied).toEqual([]);
  });

  it('refuses a bundle from a future version rather than corrupting data', () => {
    expect(() => bundleToEnvelopes(oldBundle(SCHEMA_VERSION + 5))).toThrow(/newer version of LifeOS/);
  });

  it('skips table entries that are not arrays', () => {
    const bundle = oldBundle(SCHEMA_VERSION);
    (bundle.tables as Record<string, unknown>).junk = 'not an array';
    const { envelopes } = bundleToEnvelopes(bundle);
    expect(envelopes.some((e) => e.collection === 'junk')).toBe(false);
  });
});

describe('folder round-trip', () => {
  it('survives collections -> envelopes -> files -> collections unchanged', () => {
    const collections = {
      tasks: [{ id: 't1', title: 'Write the thing' }],
      settings: [{ id: 'settings', theme: 'dark', weekStartsOn: 1 }],
    };

    const { envelopes } = bundleToEnvelopes(collectionsToBundle(collections));
    const files = Object.fromEntries(envelopes.map((e) => [e.collection, serializeEnvelope(e)]));

    const restored: Record<string, unknown[]> = {};
    for (const [name, text] of Object.entries(files)) {
      const parsed = parseEnvelope(text, name);
      expect(parsed.ok).toBe(true);
      restored[name] = parsed.envelope!.records;
    }

    expect(restored).toEqual(collections);
    // Settings really are in the files, not stranded in localStorage.
    expect(restored.settings[0]).toMatchObject({ theme: 'dark' });
  });

  it('leaves the other collections intact when one file is corrupt', () => {
    const files: Record<string, string> = {
      tasks: serializeEnvelope({
        format: 'lifeos-collection', schemaVersion: SCHEMA_VERSION, savedAt: 0,
        collection: 'tasks', records: [{ id: 't1' }],
      }),
      goals: '{"format":"lifeos-collection","records":[{"id":',
    };

    const loaded: Record<string, unknown[]> = {};
    const warnings: string[] = [];
    for (const [name, text] of Object.entries(files)) {
      const parsed = parseEnvelope(text, name);
      if (parsed.error) warnings.push(parsed.error);
      else if (parsed.envelope) loaded[name] = parsed.envelope.records;
    }

    expect(Object.keys(loaded)).toEqual(['tasks']);
    expect(loaded.tasks).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/goals/);
  });
});
