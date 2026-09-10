import { db, EXPORTABLE_TABLES, SCHEMA_VERSION, tableByName } from '@/db/db';
import { newId } from '@/lib/id';
import {
  migrateBundle, pruneInvalidRows, validateBundle,
  type ExportBundle, type ValidationReport,
} from './migrationService';
import { getSettings, updateSettings } from './settingsService';
import { DEFAULT_BACKUP_PREFERENCES, type BackupKind, type BackupSnapshot, type ID } from '@/types';

/**
 * BackupService — export, import and local snapshots.
 *
 * Everything here is offline by construction: an export is a Blob the browser
 * downloads, an import is a File the user picks, and automatic backups are
 * rows in IndexedDB. No network call exists in this file, by design.
 *
 * Attachment blobs are the one awkward case — JSON cannot hold binary — so
 * they are base64-encoded into the bundle and decoded on restore.
 */

export const APP_VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export interface ExportOptions {
  /** Include attachment blobs (base64). Large; off by default for auto backups. */
  includeAttachments?: boolean;
  /** Skip cache-like tables that can be recomputed. */
  excludeDerived?: boolean;
}

/** Tables that are pure cache and can be rebuilt from the source of truth. */
const DERIVED_TABLES = new Set(['snapshots']);

export async function buildExportBundle(options: ExportOptions = {}): Promise<ExportBundle> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const name of EXPORTABLE_TABLES) {
    if (options.excludeDerived && DERIVED_TABLES.has(name)) continue;
    const table = tableByName(name);
    if (!table) continue;
    const rows = await table.toArray();
    tables[name] = rows;
    counts[name] = rows.length;
  }

  if (options.includeAttachments) {
    const attachments = await db.attachments.toArray();
    const encoded: unknown[] = [];
    for (const a of attachments) {
      encoded.push({
        ...a,
        blob: undefined,
        blobBase64: await blobToBase64(a.blob),
      });
    }
    tables.attachments = encoded;
    counts.attachments = encoded.length;
  }

  return {
    format: 'lifeos-export',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    tables,
    counts,
  };
}

export async function exportToJson(options: ExportOptions = {}): Promise<string> {
  return JSON.stringify(await buildExportBundle(options), null, 2);
}

/** Triggers a browser download of the full export. */
export async function downloadExport(options: ExportOptions = { includeAttachments: true }): Promise<string> {
  const json = await exportToJson(options);
  const filename = `lifeos-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has definitely started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export type ImportMode =
  /** Wipe every table first — the file becomes the whole truth. */
  | 'replace'
  /** Keep existing rows; only add ids that do not exist yet. */
  | 'merge';

export interface ImportResult {
  ok: boolean;
  /** Null when validation failed before anything was written. */
  report: ValidationReport;
  migrationsApplied: string[];
  importedCounts: Record<string, number>;
  /** Snapshot taken before the import, so it can be rolled back. */
  safetySnapshotId: ID | null;
  message: string;
}

/** Parses + validates without writing anything. Safe to call on file select. */
export function inspectImportFile(text: string): {
  bundle: ExportBundle | null;
  report: ValidationReport;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      bundle: null,
      report: {
        ok: false,
        issues: [{
          severity: 'error', table: null, row: null,
          message: `The file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        }],
        acceptedCounts: {},
        droppedCount: 0,
      },
    };
  }

  const report = validateBundle(parsed);
  return { bundle: report.ok || report.issues.some((i) => i.severity === 'error') ? (parsed as ExportBundle) : (parsed as ExportBundle), report };
}

/**
 * Restores a bundle. Always takes a `pre_import` safety snapshot first, so a
 * bad restore is one click away from being reversed.
 */
export async function importBundle(
  raw: ExportBundle,
  mode: ImportMode = 'replace',
  options: { skipSafetySnapshot?: boolean; allowPartial?: boolean } = {},
): Promise<ImportResult> {
  const report = validateBundle(raw);
  if (!report.ok && !options.allowPartial) {
    return {
      ok: false,
      report,
      migrationsApplied: [],
      importedCounts: {},
      safetySnapshotId: null,
      message: 'Import cancelled — the file has errors. Nothing was changed.',
    };
  }

  let bundle = report.ok ? raw : pruneInvalidRows(raw, report);

  let migrationsApplied: string[] = [];
  try {
    const migrated = migrateBundle(bundle);
    bundle = migrated.bundle;
    migrationsApplied = migrated.applied;
  } catch (e) {
    return {
      ok: false,
      report,
      migrationsApplied: [],
      importedCounts: {},
      safetySnapshotId: null,
      message: e instanceof Error ? e.message : String(e),
    };
  }

  let safetySnapshotId: ID | null = null;
  if (!options.skipSafetySnapshot) {
    const snap = await createSnapshot('pre_import', 'Automatic snapshot taken before an import.');
    safetySnapshotId = snap.id;
  }

  const importedCounts: Record<string, number> = {};
  const targets = Object.keys(bundle.tables)
    .map((name) => ({ name, table: tableByName(name) }))
    .filter((t): t is { name: string; table: NonNullable<ReturnType<typeof tableByName>> } => t.table !== null);

  await db.transaction('rw', targets.map((t) => t.table), async () => {
    for (const { name, table } of targets) {
      const rows = bundle.tables[name] as Record<string, unknown>[];
      if (!Array.isArray(rows)) continue;

      const decoded = name === 'attachments' ? await decodeAttachments(rows) : rows;

      if (mode === 'replace') {
        await table.clear();
        await table.bulkPut(decoded);
        importedCounts[name] = decoded.length;
      } else {
        const existing = new Set((await table.toCollection().primaryKeys()).map(String));
        const fresh = decoded.filter((r) => !existing.has(String(r.id)));
        await table.bulkPut(fresh);
        importedCounts[name] = fresh.length;
      }
    }
  });

  const total = Object.values(importedCounts).reduce((s, n) => s + n, 0);
  return {
    ok: true,
    report,
    migrationsApplied,
    importedCounts,
    safetySnapshotId,
    message: `Restored ${total} record${total === 1 ? '' : 's'} across ${Object.keys(importedCounts).length} tables.${migrationsApplied.length ? ` ${migrationsApplied.length} migration${migrationsApplied.length === 1 ? '' : 's'} applied.` : ''}`,
  };
}

export async function importFromFile(
  file: File,
  mode: ImportMode = 'replace',
  options: { allowPartial?: boolean } = {},
): Promise<ImportResult> {
  const text = await file.text();
  const { bundle, report } = inspectImportFile(text);
  if (!bundle || report.issues.some((i) => i.severity === 'error' && i.table === null)) {
    return {
      ok: false,
      report,
      migrationsApplied: [],
      importedCounts: {},
      safetySnapshotId: null,
      message: report.issues[0]?.message ?? 'The file could not be read.',
    };
  }
  return importBundle(bundle, mode, options);
}

/* ------------------------------------------------------------------ */
/* Local snapshots                                                     */
/* ------------------------------------------------------------------ */

export async function createSnapshot(kind: BackupKind = 'manual', note?: string): Promise<BackupSnapshot> {
  // Attachments are excluded from snapshots: blobs would multiply IndexedDB
  // usage by the retention count for no additional safety (they are already
  // stored, and a snapshot restore does not delete them).
  const bundle = await buildExportBundle({ includeAttachments: false, excludeDerived: true });
  const payload = JSON.stringify(bundle);
  const now = Date.now();

  const snapshot: BackupSnapshot = {
    id: newId('bak'),
    createdAt: now,
    updatedAt: now,
    at: now,
    kind,
    schemaVersion: SCHEMA_VERSION,
    payload,
    sizeBytes: payload.length,
    tableCounts: bundle.counts,
    note,
  };
  await db.backups.add(snapshot);
  return snapshot;
}

export async function listSnapshots(): Promise<BackupSnapshot[]> {
  return db.backups.orderBy('at').reverse().toArray();
}

export async function deleteSnapshot(id: ID): Promise<void> {
  await db.backups.delete(id);
}

export async function restoreSnapshot(id: ID, mode: ImportMode = 'replace'): Promise<ImportResult> {
  const snapshot = await db.backups.get(id);
  if (!snapshot) {
    return {
      ok: false,
      report: { ok: false, issues: [{ severity: 'error', table: null, row: null, message: 'Snapshot not found.' }], acceptedCounts: {}, droppedCount: 0 },
      migrationsApplied: [],
      importedCounts: {},
      safetySnapshotId: null,
      message: 'That snapshot no longer exists.',
    };
  }
  const bundle = JSON.parse(snapshot.payload) as ExportBundle;
  return importBundle(bundle, mode);
}

/** Keeps only the newest `keepCount` automatic snapshots. */
export async function pruneSnapshots(keepCount: number): Promise<number> {
  const autos = await db.backups.where('kind').equals('auto').reverse().sortBy('at');
  const doomed = autos.slice(Math.max(0, keepCount));
  if (doomed.length === 0) return 0;
  await db.backups.bulkDelete(doomed.map((s) => s.id));
  return doomed.length;
}

/**
 * Startup hook: takes an automatic snapshot when one is due, then prunes.
 * Returns a message for the maintenance log, or null when nothing was due.
 */
export async function runAutoBackup(now = Date.now()): Promise<string | null> {
  const settings = await getSettings();
  const prefs = { ...DEFAULT_BACKUP_PREFERENCES, ...(settings.backup ?? {}) };
  if (!prefs.autoBackupEnabled) return null;

  const last = prefs.lastBackupAt ?? 0;
  const dueAfter = last + Math.max(1, prefs.intervalDays) * 86_400_000;
  if (now < dueAfter) return null;

  const snapshot = await createSnapshot('auto', 'Automatic local snapshot.');
  const pruned = await pruneSnapshots(prefs.keepCount);
  await updateSettings({ backup: { ...prefs, lastBackupAt: now } });

  return `Local backup saved (${formatBytes(snapshot.sizeBytes)})${pruned ? `, ${pruned} old snapshot${pruned === 1 ? '' : 's'} pruned` : ''}.`;
}

/** Wipes every table. Used by the "start over" control, always confirmed. */
export async function eraseAllData(): Promise<void> {
  const tables = [...EXPORTABLE_TABLES, 'attachments', 'backups']
    .map((n) => tableByName(n))
    .filter((t): t is NonNullable<ReturnType<typeof tableByName>> => t !== null);
  await db.transaction('rw', tables, async () => {
    for (const t of tables) await t.clear();
  });
}

/* ------------------------------------------------------------------ */
/* Storage estimate                                                    */
/* ------------------------------------------------------------------ */

export interface StorageReport {
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Approximate rows per table, for the "About my data" panel. */
  rowCounts: Record<string, number>;
  persisted: boolean;
}

export async function getStorageReport(): Promise<StorageReport> {
  const rowCounts: Record<string, number> = {};
  for (const name of [...EXPORTABLE_TABLES, 'attachments', 'backups']) {
    const table = tableByName(name);
    if (table) rowCounts[name] = await table.count();
  }

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let persisted = false;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      usageBytes = est.usage ?? null;
      quotaBytes = est.quota ?? null;
    } catch { /* estimate is best-effort */ }
    try {
      persisted = (await navigator.storage.persisted?.()) ?? false;
    } catch { /* ignore */ }
  }

  return { usageBytes, quotaBytes, rowCounts, persisted };
}

/** Asks the browser to make storage persistent so eviction cannot lose data. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function decodeAttachments(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  return rows.map((row) => {
    const base64 = row.blobBase64;
    if (typeof base64 !== 'string') return row;
    const { blobBase64: _drop, ...rest } = row;
    void _drop;
    return { ...rest, blob: base64ToBlob(base64, String(row.mime ?? 'application/octet-stream')) };
  });
}
