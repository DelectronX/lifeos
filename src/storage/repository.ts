import { db, EXPORTABLE_TABLES, SCHEMA_VERSION, tableByName } from '@/db/db';
import { flushUiState, hydrateUiState } from '@/services/uiStateStore';
import type { ExportBundle } from '@/services/migrationService';
import { migrateBundle, validateBundle } from '@/services/migrationService';
import { DownloadUploadAdapter, saveTextAsFile } from './adapters/downloadUploadAdapter';
import { collectionsToBundle, FILE_COLLECTIONS, readCollectionsFromDb } from './bundle';
import { detectAdapter, type DetectionResult } from './detect';
import {
  makeEnvelope, makeManifest, MANIFEST_NAME, parseEnvelope, parseManifest, serializeEnvelope,
} from './envelope';
import { DirtyTracker } from './dirtyTracker';
import { BUNDLE_FILENAME, type StorageAdapter, type StorageManifest } from './types';

/**
 * StorageRepository — the bridge between the app's fast working set and the
 * JSON files that are now the source of truth.
 *
 * The design constraint: ~35k lines of feature code and every `useLiveQuery`
 * in the app read from Dexie, and none of that should change. So Dexie stays
 * exactly where it is as an in-memory-speed working set, and this class:
 *
 *   - hydrates it from the JSON files at boot,
 *   - watches every table for mutations via Dexie hooks,
 *   - debounces those into per-collection writes through the active adapter,
 *   - and tracks unsaved state when the adapter cannot auto-save.
 *
 * Nothing in the feature layer knows this exists, which is the point.
 */

export type StorageStatus = 'idle' | 'saving' | 'unsaved' | 'error';

export interface StorageState {
  ready: boolean;
  adapterId: string;
  adapterLabel: string;
  adapterDescription: string;
  target: string;
  canAutoSave: boolean;
  isPersistent: boolean;
  producesRealFiles: boolean;
  status: StorageStatus;
  dirtyCollections: string[];
  lastSavedAt: number | null;
  lastError: string | null;
  /** Non-fatal problems found while loading files, e.g. one corrupt file. */
  loadWarnings: string[];
  /** True when the boot found no files and seeded them from IndexedDB. */
  migratedFromIndexedDb: boolean;
  considered: DetectionResult['considered'];
}

const DEBOUNCE_MS = 1200;

export class StorageRepository {
  private adapter: StorageAdapter | null = null;
  private detection: DetectionResult['considered'] = [];
  private tracker = new DirtyTracker();
  private listeners = new Set<(state: StorageState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private hooksInstalled = false;
  private suspended = 0;

  private state: StorageState = {
    ready: false,
    adapterId: 'memory',
    adapterLabel: 'Starting up',
    adapterDescription: '',
    target: '',
    canAutoSave: false,
    isPersistent: false,
    producesRealFiles: false,
    status: 'idle',
    dirtyCollections: [],
    lastSavedAt: null,
    lastError: null,
    loadWarnings: [],
    migratedFromIndexedDb: false,
    considered: [],
  };

  getState(): StorageState {
    return this.state;
  }

  getAdapter(): StorageAdapter | null {
    return this.adapter;
  }

  subscribe(listener: (state: StorageState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private patch(next: Partial<StorageState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Boot sequence:
   *   1. pick the best adapter for this environment,
   *   2. load `data/*.json` into Dexie if the files exist,
   *   3. otherwise keep whatever IndexedDB already holds and write it out as
   *      files on the first save — a one-time migration, so an existing user
   *      upgrading into this build loses nothing,
   *   4. otherwise start empty.
   */
  async init(adapter?: StorageAdapter): Promise<StorageState> {
    if (adapter) {
      this.adapter = adapter;
      this.detection = [];
    } else {
      const result = await detectAdapter();
      this.adapter = result.adapter;
      this.detection = result.considered;
    }

    this.applyAdapterToState();

    const warnings: string[] = [];
    let hydrated = 0;
    try {
      hydrated = await this.hydrateFromFiles(warnings);
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e));
    }

    let migrated = false;
    if (hydrated === 0) {
      // No usable files. Anything already in IndexedDB becomes the seed.
      const existing = await countWorkingSet();
      if (existing > 0) {
        migrated = true;
        this.tracker.markAll(FILE_COLLECTIONS);
      }
    }

    this.installHooks();

    // The synchronous UI-state mirror has to be populated from the freshly
    // hydrated settings row BEFORE the first render, or the rail, the palette
    // recents and a running timer would all start from their defaults and then
    // immediately overwrite the persisted values with those defaults.
    await hydrateUiState();

    this.patch({
      ready: true,
      loadWarnings: warnings,
      migratedFromIndexedDb: migrated,
      considered: this.detection,
      dirtyCollections: this.tracker.snapshot(),
      status: this.tracker.isDirty() ? (this.state.canAutoSave ? 'saving' : 'unsaved') : 'idle',
    });

    if (migrated && this.state.canAutoSave) void this.flush();
    return this.state;
  }

  private applyAdapterToState(): void {
    const adapter = this.adapter;
    if (!adapter) return;
    this.patch({
      adapterId: adapter.id,
      adapterLabel: adapter.capabilities.label,
      adapterDescription: adapter.capabilities.description,
      target: adapter.target(),
      canAutoSave: adapter.capabilities.canAutoSave,
      isPersistent: adapter.capabilities.isPersistent,
      producesRealFiles: adapter.capabilities.producesRealFiles,
    });
  }

  /**
   * Loads every collection file into Dexie. Returns the number of collections
   * that actually produced records, so the caller can tell "no files yet"
   * from "files present but empty".
   *
   * A corrupt file is reported and SKIPPED rather than aborting the boot: one
   * unreadable `activities.json` must not cost the user their tasks.
   */
  private async hydrateFromFiles(warnings: string[]): Promise<number> {
    const adapter = this.adapter;
    if (!adapter) return 0;

    const manifestText = await adapter.read(MANIFEST_NAME).catch(() => null);
    const manifest = parseManifest(manifestText);

    let loaded = 0;
    const collections: Record<string, unknown[]> = {};
    let maxVersion = 0;

    for (const name of FILE_COLLECTIONS) {
      let text: string | null = null;
      try {
        text = await adapter.read(name);
      } catch (e) {
        warnings.push(`Could not read ${name}.json: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const parsed = parseEnvelope(text, name);
      if (parsed.error) {
        warnings.push(parsed.error);
        continue;
      }
      if (!parsed.envelope) continue;
      collections[name] = parsed.envelope.records;
      maxVersion = Math.max(maxVersion, parsed.envelope.schemaVersion);
      loaded++;
    }

    if (loaded === 0) return 0;

    // Run the files through the same migration ladder as an imported backup,
    // so an older data folder is upgraded on load rather than half-read.
    let bundle = collectionsToBundle(collections);
    bundle.schemaVersion = maxVersion || manifest?.schemaVersion || SCHEMA_VERSION;
    try {
      bundle = migrateBundle(bundle).bundle;
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e));
      return 0;
    }

    await this.writeToWorkingSet(bundle);

    this.patch({ lastSavedAt: manifest?.savedAt ?? null });
    return Object.values(bundle.tables).filter((rows) => Array.isArray(rows)).length;
  }

  /** Replaces the Dexie working set with the given bundle, hooks suspended. */
  private async writeToWorkingSet(bundle: ExportBundle): Promise<void> {
    this.suspended++;
    try {
      for (const [name, rows] of Object.entries(bundle.tables)) {
        const table = tableByName(name);
        if (!table || !Array.isArray(rows)) continue;
        await table.clear();
        if (rows.length) await table.bulkPut(rows as Record<string, unknown>[]);
      }
    } finally {
      this.suspended--;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Change tracking                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Dexie table hooks are the seam that lets every existing service keep
   * calling `db.tasks.put(...)` unchanged while still producing a file write.
   */
  private installHooks(): void {
    if (this.hooksInstalled) return;
    this.hooksInstalled = true;

    for (const name of FILE_COLLECTIONS) {
      const table = tableByName(name);
      if (!table) continue;
      const touch = () => this.onMutation(name);
      table.hook('creating', touch);
      table.hook('updating', touch);
      table.hook('deleting', touch);
    }
  }

  private onMutation(collection: string): void {
    if (this.suspended > 0) return;
    this.tracker.mark(collection);
    this.patch({
      dirtyCollections: this.tracker.snapshot(),
      status: this.state.canAutoSave ? 'saving' : 'unsaved',
    });
    this.schedule();
  }

  private schedule(): void {
    if (!this.state.canAutoSave) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  /* ---------------------------------------------------------------- */
  /* Saving                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Writes every dirty collection, then the manifest.
   *
   * Ordering matters: data files first, manifest last. The manifest is what
   * declares "this folder is complete and holds N records", so if the process
   * dies mid-flush the manifest still describes the previous consistent state
   * rather than claiming a write that never landed.
   */
  async flush(): Promise<boolean> {
    if (this.flushing) return this.flushing.then(() => this.state.status !== 'error');
    const adapter = this.adapter;
    if (!adapter) return false;
    if (!this.tracker.isDirty()) {
      // Nothing marked — but a UI-state change may still be sitting in the
      // debounce. Settle it and re-check rather than reporting a false "clean".
      await flushUiState();
      if (!this.tracker.isDirty()) return true;
      // Settling it may have started a flush of its own; join that one.
      const inFlight = this.flushing as Promise<void> | null;
      if (inFlight) return inFlight.then(() => this.state.status !== 'error');
    }

    const run = async (): Promise<void> => {
      // Anything typed in the last few hundred ms belongs in this write.
      await flushUiState();
      const names = this.tracker.take();
      if (names.length === 0) return;
      this.patch({ status: 'saving', dirtyCollections: this.tracker.snapshot() });

      try {
        const counts: Record<string, number> = {};
        for (const name of names) {
          const table = tableByName(name);
          if (!table) continue;
          const rows = await table.toArray();
          counts[name] = rows.length;
          await adapter.write(name, serializeEnvelope(makeEnvelope(name, rows)));
        }

        // Merge into the previous manifest so untouched collections keep
        // their recorded counts.
        const previous = parseManifest(await adapter.read(MANIFEST_NAME).catch(() => null));
        const savedAt = Date.now();
        const manifest = makeManifest(
          { ...(previous?.counts ?? {}), ...counts },
          adapter.id,
          savedAt,
        );
        await adapter.write(MANIFEST_NAME, JSON.stringify(manifest, null, 2));

        this.tracker.settle();
        this.patch({
          status: this.tracker.isDirty() ? 'saving' : 'idle',
          dirtyCollections: this.tracker.snapshot(),
          lastSavedAt: savedAt,
          lastError: null,
        });
      } catch (e) {
        this.tracker.restore();
        this.patch({
          status: 'error',
          dirtyCollections: this.tracker.snapshot(),
          lastError: e instanceof Error ? e.message : String(e),
        });
      }
    };

    this.flushing = run().finally(() => {
      this.flushing = null;
    });
    await this.flushing;

    // A mutation that landed during the write leaves the tracker dirty again.
    if (this.tracker.isDirty() && this.state.status !== 'error') this.schedule();
    return this.state.status !== 'error';
  }

  /** Forces a full rewrite of every collection, e.g. after "Choose folder". */
  async saveAll(): Promise<boolean> {
    this.tracker.markAll(FILE_COLLECTIONS);
    this.patch({ dirtyCollections: this.tracker.snapshot() });
    return this.flush();
  }

  /* ---------------------------------------------------------------- */
  /* Bundle transport                                                  */
  /* ---------------------------------------------------------------- */

  /** The whole working set as one `lifeos.json` string. */
  async buildBundleText(): Promise<string> {
    // Anything still sitting in the debounced UI-state mirror belongs in the
    // bundle: exporting a file that omits the last thing you changed is a bug.
    await flushUiState();
    const collections = await readCollectionsFromDb();
    return JSON.stringify(collectionsToBundle(collections), null, 2);
  }

  /**
   * Manual-mode save: hands the user a real file. This is the *only* way data
   * becomes durable when `canAutoSave` is false, so it also clears the dirty
   * flag and the before-unload prompt.
   */
  async saveBundleToFile(filename = BUNDLE_FILENAME): Promise<'shared' | 'downloaded'> {
    const text = await this.buildBundleText();
    const result = await saveTextAsFile(filename, text);
    // Mirror into the cache too, so a refresh does not lose the work.
    if (this.adapter instanceof DownloadUploadAdapter) await this.flushToCacheSilently();
    this.tracker.clear();
    this.patch({ status: 'idle', dirtyCollections: [], lastSavedAt: Date.now(), lastError: null });
    return result;
  }

  /** Writes every collection to the adapter without touching dirty state. */
  private async flushToCacheSilently(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    try {
      const counts: Record<string, number> = {};
      for (const name of FILE_COLLECTIONS) {
        const table = tableByName(name);
        if (!table) continue;
        const rows = await table.toArray();
        counts[name] = rows.length;
        await adapter.write(name, serializeEnvelope(makeEnvelope(name, rows)));
      }
      await adapter.write(MANIFEST_NAME, JSON.stringify(makeManifest(counts, adapter.id), null, 2));
    } catch { /* the cache is best-effort; the downloaded file is the truth */ }
  }

  /**
   * Imports a bundle (from a file input, a drop or a paste), replacing the
   * working set and immediately persisting it through the active adapter.
   */
  async importBundleText(text: string): Promise<{ ok: boolean; message: string; applied: string[] }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, applied: [], message: `That file is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }

    const report = validateBundle(parsed);
    if (!report.ok) {
      const first = report.issues.find((i) => i.severity === 'error');
      return { ok: false, applied: [], message: first?.message ?? 'The file could not be read.' };
    }

    let applied: string[] = [];
    let bundle = parsed as ExportBundle;
    try {
      const outcome = migrateBundle(bundle);
      bundle = outcome.bundle;
      applied = outcome.applied;
    } catch (e) {
      return { ok: false, applied: [], message: e instanceof Error ? e.message : String(e) };
    }

    await this.writeToWorkingSet(bundle);
    // Adopt the imported settings (theme, rail state, ...) into the live mirror
    // so the UI reflects the bundle instead of the state it had a moment ago.
    await hydrateUiState();
    await this.saveAll();

    const total = Object.values(bundle.tables).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
    return {
      ok: true,
      applied,
      message: `Restored ${total} record${total === 1 ? '' : 's'} from the file.`,
    };
  }

  /**
   * Live record counts straight out of the working set, for the Settings
   * panel. Deliberately NOT read from the manifest: the manifest describes
   * what was last written, and showing that as "what you have" would hide
   * exactly the unsaved work the user needs to know about.
   */
  async getCollectionCounts(): Promise<{ name: string; count: number; dirty: boolean }[]> {
    const dirty = new Set(this.tracker.snapshot());
    const out: { name: string; count: number; dirty: boolean }[] = [];
    for (const name of FILE_COLLECTIONS) {
      const table = tableByName(name);
      if (!table) continue;
      out.push({ name, count: await table.count(), dirty: dirty.has(name) });
    }
    return out;
  }

  /** Current manifest as written on the target, for the Settings panel. */
  async readManifest(): Promise<StorageManifest | null> {
    if (!this.adapter) return null;
    return parseManifest(await this.adapter.read(MANIFEST_NAME).catch(() => null));
  }

  /** Swaps in a different backend at runtime (e.g. the user picked a folder). */
  async useAdapter(adapter: StorageAdapter): Promise<void> {
    this.adapter = adapter;
    this.applyAdapterToState();
    await this.saveAll();
  }
}

async function countWorkingSet(): Promise<number> {
  let total = 0;
  for (const name of EXPORTABLE_TABLES) {
    const table = tableByName(name);
    if (!table) continue;
    total += await table.count();
    if (total > 0) return total;
  }
  return total;
}

/** The app-wide repository. Feature code never touches this directly. */
export const storage = new StorageRepository();

/** Re-exported so callers do not need to reach into the db module. */
export { db };
