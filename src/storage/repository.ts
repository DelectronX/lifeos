import { db, EXPORTABLE_TABLES, SCHEMA_VERSION, tableByName } from '@/db/db';
import { flushUiState, hydrateUiState } from '@/services/uiStateStore';
import type { ExportBundle } from '@/services/migrationService';
import { migrateBundle, validateBundle } from '@/services/migrationService';
import {
  canShareFiles, DownloadUploadAdapter, requestPersistentStorage, saveTextAsFile, type SaveOutcome,
} from './adapters/downloadUploadAdapter';
import { SingleFileAdapter, type BoundTargetInfo } from './adapters/singleFileAdapter';
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

  /* --- Bound save target --- */
  /** True when this browser can bind one file to overwrite (desktop Chromium). */
  canBindFile: boolean;
  /** Live state of the bound file, or null when the concept does not apply. */
  boundTarget: BoundTargetInfo | null;
  /**
   * True when Save hands the user a file they must confirm replacing, rather
   * than writing in place. Drives the honest copy in the UI.
   */
  savesByHandOff: boolean;
  /** True when Save will open a share sheet (iOS) rather than download. */
  usesShareSheet: boolean;
  /** The exact filename every manual save produces. Never varies. */
  saveFilename: string;
  /** Whether the browser promised to keep the local cache. */
  storagePersistence: 'persisted' | 'denied' | 'unsupported' | 'unknown';
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
    canBindFile: false,
    boundTarget: null,
    savesByHandOff: false,
    usesShareSheet: false,
    saveFilename: BUNDLE_FILENAME,
    storagePersistence: 'unknown',
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

    // Keep a probe around when a file was bound but is not the active
    // adapter, so Settings can offer "Reconnect" instead of going quiet.
    if (!(this.adapter instanceof SingleFileAdapter) && SingleFileAdapter.isAvailable()) {
      const probe = new SingleFileAdapter();
      await probe.ensureReady().catch(() => false);
      if (probe.info().status !== 'unbound') this.boundProbe = probe;
    }

    this.applyAdapterToState();

    // Ask the browser to keep the local cache. Matters most on iOS, where the
    // cache is all that stands between the user and lost work between saves.
    void requestPersistentStorage().then((storagePersistence) => this.patch({ storagePersistence }));

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
    const bound = adapter instanceof SingleFileAdapter ? adapter.info() : this.boundProbe?.info() ?? null;
    this.patch({
      adapterId: adapter.id,
      adapterLabel: adapter.capabilities.label,
      adapterDescription: adapter.capabilities.description,
      target: adapter.target(),
      canAutoSave: adapter.capabilities.canAutoSave,
      isPersistent: adapter.capabilities.isPersistent,
      producesRealFiles: adapter.capabilities.producesRealFiles,
      canBindFile: SingleFileAdapter.isAvailable(),
      boundTarget: bound,
      // Only the manual mode hands a file over; everything else writes.
      savesByHandOff: adapter.id === 'download',
      usesShareSheet: adapter.id === 'download' && canShareFiles(),
      saveFilename: BUNDLE_FILENAME,
    });
  }

  /**
   * A non-active SingleFileAdapter kept around purely so Settings can report
   * "a file is bound but its permission lapsed" while some other adapter is
   * live. Never written through.
   */
  private boundProbe: SingleFileAdapter | null = null;

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
        this.refreshBoundTarget();
      } catch (e) {
        this.tracker.restore();
        this.patch({
          status: 'error',
          dirtyCollections: this.tracker.snapshot(),
          lastError: e instanceof Error ? e.message : String(e),
        });
        // A bound-file write failing usually means the grant lapsed or the
        // file moved; surface the new status so the UI can offer Reconnect.
        this.refreshBoundTarget();
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

  /* ---------------------------------------------------------------- */
  /* Bound save target                                                 */
  /* ---------------------------------------------------------------- */

  /** The SingleFileAdapter in play, active or probe, if any. */
  private singleFile(): SingleFileAdapter | null {
    if (this.adapter instanceof SingleFileAdapter) return this.adapter;
    return this.boundProbe;
  }

  private refreshBoundTarget(): void {
    const single = this.singleFile();
    this.patch({ boundTarget: single ? single.info() : null, target: this.adapter?.target() ?? '' });
  }

  /**
   * Opens the save-file picker and binds the chosen file as the permanent
   * save target, then writes the whole working set into it immediately, so
   * "pick a file" and "the file now holds my data" are one action.
   *
   * Must be called from a user gesture.
   */
  async bindSaveFile(): Promise<{ ok: boolean; message: string; info: BoundTargetInfo | null }> {
    if (!SingleFileAdapter.isAvailable()) {
      return {
        ok: false,
        info: null,
        message:
          'This environment has no File System Access API, so no file can be bound. Saving here hands you a copy of lifeos.json to replace by hand.',
      };
    }
    const adapter = this.adapter instanceof SingleFileAdapter ? this.adapter : new SingleFileAdapter();
    const result = await adapter.bind(BUNDLE_FILENAME);
    if (result.cancelled) {
      return { ok: false, info: adapter.info(), message: 'No file chosen — nothing changed.' };
    }
    if (result.status !== 'granted') {
      this.boundProbe = adapter;
      this.refreshBoundTarget();
      return { ok: false, info: result, message: result.message };
    }

    this.boundProbe = null;
    this.adapter = adapter;
    this.applyAdapterToState();
    const ok = await this.saveAll();
    this.refreshBoundTarget();
    return {
      ok,
      info: adapter.info(),
      message: ok
        ? `Bound to ${result.filename ?? BUNDLE_FILENAME}. Every Save from now on overwrites that file — no picker, no duplicates.`
        : this.state.lastError ?? 'The file was bound but the first write failed.',
    };
  }

  /** Re-requests write permission on the bound file. Needs a user gesture. */
  async reconnectSaveFile(): Promise<{ ok: boolean; message: string; info: BoundTargetInfo | null }> {
    const adapter = this.singleFile();
    if (!adapter) {
      return { ok: false, info: null, message: 'No file is bound, so there is nothing to reconnect.' };
    }
    const info = await adapter.reconnect();
    if (info.status !== 'granted') {
      this.refreshBoundTarget();
      return { ok: false, info, message: info.message };
    }
    this.boundProbe = null;
    this.adapter = adapter;
    this.applyAdapterToState();
    const ok = await this.saveAll();
    this.refreshBoundTarget();
    return {
      ok,
      info: adapter.info(),
      message: ok
        ? `Reconnected to ${info.filename}. It is up to date again.`
        : this.state.lastError ?? 'Reconnected, but the write failed.',
    };
  }

  /**
   * Forgets the bound file and falls back to whatever this environment can do
   * instead. The file on disk is left alone.
   */
  async unbindSaveFile(): Promise<string> {
    const adapter = this.singleFile();
    if (!adapter) return 'No file was bound.';
    const name = adapter.info().filename ?? BUNDLE_FILENAME;
    await adapter.unbind();
    this.boundProbe = null;
    if (this.adapter instanceof SingleFileAdapter) {
      const result = await detectAdapter();
      this.adapter = result.adapter;
      this.detection = result.considered;
      this.applyAdapterToState();
      this.patch({ considered: result.considered });
      this.tracker.markAll(FILE_COLLECTIONS);
      this.patch({ dirtyCollections: this.tracker.snapshot(), status: 'unsaved' });
    }
    this.refreshBoundTarget();
    return `${name} is no longer bound. Your data is untouched, and it is still on disk exactly as it was last saved.`;
  }

  /* ---------------------------------------------------------------- */
  /* The one Save                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * What the Save button and Ctrl/Cmd+S both call. One entry point, because
   * "what does Save do here" is a storage-layer question, not a component's.
   *
   *  - bound file / server / folder -> writes in place, silently;
   *  - manual mode -> hands over exactly `lifeos.json`, and on first use in a
   *    browser that supports it, offers to bind that file permanently.
   */
  async save(): Promise<{ ok: boolean; mode: 'in-place' | 'shared' | 'downloaded'; message: string }> {
    if (this.state.canAutoSave) {
      const ok = await this.flush();
      const where = this.state.boundTarget?.filename ?? this.state.target;
      return {
        ok,
        mode: 'in-place',
        message: ok
          ? `Saved. ${where} was overwritten in place.`
          : this.state.lastError ?? 'The save failed.',
      };
    }

    // Bind-on-first-save: where the browser can bind a file, a manual Save
    // should not produce yet another download. Pick the file once, through
    // the same click, and every later Save overwrites it.
    if (SingleFileAdapter.isAvailable()) {
      const bound = await this.bindSaveFile();
      if (bound.ok) return { ok: true, mode: 'in-place', message: bound.message };
      if (bound.info && bound.info.status !== 'unbound') {
        return { ok: false, mode: 'in-place', message: bound.message };
      }
      // Picker cancelled or unusable — fall through to the hand-off path
      // rather than losing the click.
    }

    const how = await this.saveBundleToFile(BUNDLE_FILENAME);
    return {
      ok: true,
      mode: how,
      message:
        how === 'shared'
          ? `${BUNDLE_FILENAME} is in the share sheet — pick your file manager and choose Replace.`
          : `${BUNDLE_FILENAME} was saved. Confirm replacing the existing copy; the name never changes, so there is only ever one.`,
    };
  }

  /**
   * Manual-mode save: hands the user a real file. This is the *only* way data
   * becomes durable when `canAutoSave` is false, so it also clears the dirty
   * flag and the before-unload prompt.
   *
   * The filename is deliberately fixed: a timestamped name is what produces
   * `lifeos (1).json`, `lifeos (2).json` and a folder the user has to police.
   */
  async saveBundleToFile(filename = BUNDLE_FILENAME): Promise<SaveOutcome> {
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
