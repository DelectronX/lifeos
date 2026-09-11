import { EXPORTABLE_TABLES, SCHEMA_VERSION, tableByName } from '@/db/db';
import { migrateBundle, type ExportBundle } from '@/services/migrationService';
import { APP_VERSION } from './envelope';
import type { StorageEnvelope } from './types';

/**
 * Bundle <-> per-collection conversion.
 *
 * Two shapes of the same data exist on purpose:
 *
 *  - the **folder** (`data/tasks.json`, `data/settings.json`, …) is the live
 *    storage layout: one file per entity type, so a sync client only moves
 *    what changed and a human can read a single table.
 *  - the **bundle** (`lifeos.json`) is the transport layout: one file for
 *    export, import, transfer between devices and manual-file mode.
 *
 * The bundle format is deliberately the existing `lifeos-export` format used
 * by backupService/migrationService, so old backups import unchanged and there
 * is exactly one migration ladder to maintain.
 */

export type CollectionMap = Record<string, unknown[]>;

export function collectionsToBundle(collections: CollectionMap, exportedAt = Date.now()): ExportBundle {
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(collections)) counts[name] = rows.length;
  return {
    format: 'lifeos-export',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt,
    tables: { ...collections },
    counts,
  };
}

/** Splits a bundle into per-collection envelopes, migrating it first. */
export function bundleToEnvelopes(bundle: ExportBundle, savedAt = Date.now()): {
  envelopes: StorageEnvelope[];
  applied: string[];
} {
  const { bundle: current, applied } = migrateBundle(bundle);
  const envelopes: StorageEnvelope[] = [];
  for (const [collection, records] of Object.entries(current.tables)) {
    if (!Array.isArray(records)) continue;
    envelopes.push({
      format: 'lifeos-collection',
      schemaVersion: current.schemaVersion,
      savedAt,
      collection,
      records,
    });
  }
  return { envelopes, applied };
}

/** Every collection persisted as its own file. */
export const FILE_COLLECTIONS: readonly string[] = EXPORTABLE_TABLES;

/** Reads the whole working set out of Dexie as a collection map. */
export async function readCollectionsFromDb(names: readonly string[] = FILE_COLLECTIONS): Promise<CollectionMap> {
  const out: CollectionMap = {};
  for (const name of names) {
    const table = tableByName(name);
    if (!table) continue;
    out[name] = await table.toArray();
  }
  return out;
}
