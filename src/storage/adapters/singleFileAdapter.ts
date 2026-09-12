import { SCHEMA_VERSION } from '@/db/db';
import { APP_VERSION, makeEnvelope, makeManifest, parseEnvelope, parseManifest, serializeEnvelope } from '../envelope';
import { deleteHandle, getHandle, HANDLE_KEYS, putHandle } from '../handleStore';
import { BUNDLE_FILENAME, MANIFEST_NAME, type AdapterCapabilities, type StorageAdapter } from '../types';

/**
 * SingleFileAdapter — the "bound save target".
 *
 * The user picks (or exports) **one** `lifeos.json` once. The
 * `FileSystemFileHandle` that pick produced is kept in IndexedDB, so every
 * later Save re-opens that same handle and overwrites that same file in
 * place: no picker, no prompt, no `lifeos (1).json`.
 *
 * Why the whole bundle rather than a folder of per-collection files: the user
 * asked for *one* file they keep in their file manager, and a single
 * `showSaveFilePicker` grant covers exactly one file. The directory adapter
 * still exists for people who want the split `data/*.json` layout.
 *
 * Structurally this adapter presents the same collection-shaped surface as
 * every other backend (`read('tasks')` / `write('tasks', …)`); it just keeps
 * the collections in a bundle held in memory and coalesces the physical write
 * so one Save is one file write rather than twenty-three.
 */

/* ------------------------------------------------------------------ */
/* Structural types — TS's DOM lib does not ship these everywhere.     */
/* ------------------------------------------------------------------ */

export interface FsWritableStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface FsBoundFileHandle {
  readonly name: string;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FsWritableStream>;
  getFile(): Promise<{ text(): Promise<string>; lastModified?: number }>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

export type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<FsBoundFileHandle>;

/**
 * What the UI needs to know about the bound target.
 *
 *  - `unsupported` — this environment has no `showSaveFilePicker` at all.
 *  - `unbound`     — supported, but the user has not picked a file yet.
 *  - `granted`     — bound and writable right now.
 *  - `prompt`      — bound, but the browser dropped the grant between
 *                    sessions; a click must call `reconnect()`.
 *  - `denied`      — bound, and permission was refused.
 *  - `missing`     — the file was moved, renamed or deleted behind our back.
 */
export type BoundTargetStatus = 'unsupported' | 'unbound' | 'granted' | 'prompt' | 'denied' | 'missing';

export interface BoundTargetInfo {
  status: BoundTargetStatus;
  /** Filename of the bound file, when there is one. */
  filename: string | null;
  /** When this adapter last wrote the file, epoch ms. */
  lastWrittenAt: number | null;
  /** One sentence the UI can show verbatim. Always actionable. */
  message: string;
}

/** The transport bundle shape, declared locally to keep this file standalone. */
interface BundleShape {
  format: 'lifeos-export';
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
}

export interface SingleFileAdapterOptions {
  /** Injected in tests; defaults to `globalThis.showSaveFilePicker`. */
  picker?: SaveFilePicker | null;
  /** Injected in tests; defaults to the IndexedDB handle store. */
  loadHandle?: () => Promise<FsBoundFileHandle | null>;
  saveHandle?: (handle: FsBoundFileHandle) => Promise<void>;
  forgetHandle?: () => Promise<void>;
}

function emptyBundle(): BundleShape {
  return {
    format: 'lifeos-export',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: 0,
    tables: {},
    counts: {},
  };
}

export class SingleFileAdapter implements StorageAdapter {
  readonly id = 'singlefile' as const;
  readonly capabilities: AdapterCapabilities = {
    canAutoSave: true,
    isPersistent: true,
    producesRealFiles: true,
    label: 'Bound file',
    description:
      'Every save overwrites the one JSON file you picked, in place. No picker, no prompt, no duplicate copies.',
  };

  private handle: FsBoundFileHandle | null = null;
  private status: BoundTargetStatus = 'unbound';
  private lastWrittenAt: number | null = null;
  private bundle: BundleShape = emptyBundle();
  private loaded = false;
  private writing: Promise<void> | null = null;
  private pendingWrite = false;

  private readonly picker: SaveFilePicker | null;
  private readonly loadStoredHandle: () => Promise<FsBoundFileHandle | null>;
  private readonly storeHandle: (handle: FsBoundFileHandle) => Promise<void>;
  private readonly forgetStoredHandle: () => Promise<void>;

  constructor(options: SingleFileAdapterOptions = {}) {
    this.picker = options.picker !== undefined ? options.picker : SingleFileAdapter.nativePicker();
    this.loadStoredHandle =
      options.loadHandle ?? (() => getHandle<FsBoundFileHandle>(HANDLE_KEYS.bundleFile));
    this.storeHandle = options.saveHandle ?? ((handle) => putHandle(HANDLE_KEYS.bundleFile, handle));
    this.forgetStoredHandle = options.forgetHandle ?? (() => deleteHandle(HANDLE_KEYS.bundleFile));
    if (!this.picker) this.status = 'unsupported';
  }

  /* ---------------------------------------------------------------- */
  /* Availability                                                      */
  /* ---------------------------------------------------------------- */

  private static nativePicker(): SaveFilePicker | null {
    const g = globalThis as unknown as { showSaveFilePicker?: SaveFilePicker };
    return typeof g.showSaveFilePicker === 'function' ? g.showSaveFilePicker.bind(globalThis) : null;
  }

  /** True when this browser can bind a single file at all. */
  static isAvailable(): boolean {
    return SingleFileAdapter.nativePicker() !== null;
  }

  /** True when a file was bound at some point, even if the grant lapsed. */
  static async hasBoundTarget(): Promise<boolean> {
    return (await getHandle<FsBoundFileHandle>(HANDLE_KEYS.bundleFile)) !== null;
  }

  target(): string {
    return this.handle ? this.handle.name : 'no file bound yet';
  }

  info(): BoundTargetInfo {
    return {
      status: this.status,
      filename: this.handle?.name ?? null,
      lastWrittenAt: this.lastWrittenAt,
      message: this.describe(),
    };
  }

  private describe(): string {
    const name = this.handle?.name ?? BUNDLE_FILENAME;
    switch (this.status) {
      case 'unsupported':
        return 'This browser cannot bind a file to save into — it has no File System Access API.';
      case 'unbound':
        return 'No file is bound yet. Choose a file once and every Save after that will overwrite it.';
      case 'granted':
        return `Saving straight into ${name}. No prompts, no duplicates.`;
      case 'prompt':
        return `${name} is still bound, but this browser drops the write permission between visits. Press “Reconnect file” once to restore it.`;
      case 'denied':
        return `Write permission for ${name} was refused. Press “Reconnect file” and allow it, or choose a different file.`;
      case 'missing':
        return `${name} could not be opened — it was moved, renamed or deleted. Choose the file again.`;
      default:
        return '';
    }
  }

  /* ---------------------------------------------------------------- */
  /* Binding lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Boot-time readiness. Re-acquires the stored handle and asks — never
   * requests — for permission, because `requestPermission` outside a user
   * gesture throws. Returns false with a specific `status` the UI turns into
   * a single clear action, not a silent failure.
   */
  async ensureReady(): Promise<boolean> {
    if (!this.picker) {
      this.status = 'unsupported';
      return false;
    }
    if (this.handle && this.status === 'granted') return true;

    const stored = await this.loadStoredHandle().catch(() => null);
    if (!stored) {
      this.status = 'unbound';
      return false;
    }
    this.handle = stored;

    const permission = (await stored.queryPermission?.({ mode: 'readwrite' }).catch(() => 'prompt' as PermissionState)) ?? 'granted';
    if (permission !== 'granted') {
      this.status = permission === 'denied' ? 'denied' : 'prompt';
      return false;
    }

    this.status = 'granted';
    return true;
  }

  /**
   * Re-requests permission on the already-bound handle. MUST be called from a
   * user gesture — browsers refuse otherwise, and that is not something we
   * can work around, only explain.
   */
  async reconnect(): Promise<BoundTargetInfo> {
    const stored = this.handle ?? (await this.loadStoredHandle().catch(() => null));
    if (!stored) {
      this.handle = null;
      this.status = this.picker ? 'unbound' : 'unsupported';
      return this.info();
    }
    this.handle = stored;
    try {
      const permission = (await stored.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
      this.status = permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'prompt';
    } catch {
      this.status = 'denied';
    }
    if (this.status === 'granted') this.loaded = false;
    return this.info();
  }

  /**
   * Opens the save-file picker and binds whatever the user chose. Needs a
   * user gesture. Returns the resulting state; a cancelled picker leaves the
   * previous binding untouched and is not an error.
   */
  async bind(suggestedName = BUNDLE_FILENAME): Promise<BoundTargetInfo & { cancelled: boolean }> {
    if (!this.picker) return { ...this.info(), cancelled: false };
    let handle: FsBoundFileHandle;
    try {
      handle = await this.picker({
        suggestedName,
        types: [{ description: 'LifeOS data', accept: { 'application/json': ['.json'] } }],
      });
    } catch {
      // AbortError — the user closed the picker. Keep the old binding.
      return { ...this.info(), cancelled: true };
    }

    const permission = (await handle.requestPermission?.({ mode: 'readwrite' }).catch(() => 'denied' as PermissionState)) ?? 'granted';
    if (permission !== 'granted') {
      this.status = permission === 'denied' ? 'denied' : 'prompt';
      return { ...this.info(), cancelled: false };
    }

    this.handle = handle;
    this.status = 'granted';
    this.loaded = false;
    await this.storeHandle(handle).catch(() => {
      /* A handle we cannot persist still works for this session; the user
         would just have to pick again next visit. Not worth failing a save. */
    });
    return { ...this.info(), cancelled: false };
  }

  /** Drops the binding. The file on disk is left exactly as it is. */
  async unbind(): Promise<BoundTargetInfo> {
    this.handle = null;
    this.status = this.picker ? 'unbound' : 'unsupported';
    this.lastWrittenAt = null;
    this.loaded = false;
    await this.forgetStoredHandle().catch(() => { /* best effort */ });
    return this.info();
  }

  /* ---------------------------------------------------------------- */
  /* Collection surface                                                */
  /* ---------------------------------------------------------------- */

  private requireHandle(): FsBoundFileHandle {
    if (!this.handle) {
      throw new Error(
        this.picker
          ? 'No save file is bound yet. Choose a file in Settings → Storage, then every Save writes into it.'
          : 'This environment cannot bind a file to save into.',
      );
    }
    if (this.status === 'prompt') {
      throw new Error(`${this.handle.name} needs its write permission restored. Press “Reconnect file”.`);
    }
    if (this.status === 'denied') {
      throw new Error(`Write permission for ${this.handle.name} was refused. Press “Reconnect file” and allow it, or choose another file.`);
    }
    return this.handle;
  }

  /** Reads the bound file once per session (or after a rebind). */
  private async load(): Promise<BundleShape> {
    if (this.loaded) return this.bundle;
    const handle = this.requireHandle();
    let text = '';
    try {
      text = await (await handle.getFile()).text();
    } catch {
      this.status = 'missing';
      throw new Error(`${handle.name} could not be opened — it may have been moved or deleted. Choose the file again in Settings → Storage.`);
    }
    this.loaded = true;
    this.bundle = parseBundle(text) ?? emptyBundle();
    return this.bundle;
  }

  async read(name: string): Promise<string | null> {
    if (!this.handle) return null;
    let bundle: BundleShape;
    try {
      bundle = await this.load();
    } catch {
      return null; // boot must not die on an unreadable target; status carries it
    }

    if (name === MANIFEST_NAME) {
      if (!bundle.exportedAt) return null;
      return JSON.stringify(makeManifest(bundle.counts, this.id, bundle.exportedAt), null, 2);
    }
    const records = bundle.tables[name];
    if (!Array.isArray(records)) return null;
    return serializeEnvelope(makeEnvelope(name, records, bundle.schemaVersion, bundle.exportedAt));
  }

  async write(name: string, text: string): Promise<void> {
    this.requireHandle();
    await this.load().catch(() => emptyBundle());

    if (name === MANIFEST_NAME) {
      const manifest = parseManifest(text);
      if (manifest) {
        this.bundle.schemaVersion = manifest.schemaVersion;
        this.bundle.appVersion = manifest.appVersion;
        this.bundle.exportedAt = manifest.savedAt;
      }
    } else {
      const parsed = parseEnvelope(text, name);
      if (parsed.error) throw new Error(parsed.error);
      const records = parsed.envelope?.records ?? [];
      this.bundle.tables[name] = records;
      this.bundle.counts[name] = records.length;
      if (parsed.envelope?.schemaVersion) this.bundle.schemaVersion = parsed.envelope.schemaVersion;
      this.bundle.exportedAt = Date.now();
    }

    await this.commit();
  }

  async list(): Promise<string[]> {
    if (!this.handle) return [];
    try {
      return Object.keys((await this.load()).tables);
    } catch {
      return [];
    }
  }

  async remove(name: string): Promise<void> {
    if (!this.handle) return;
    await this.load();
    delete this.bundle.tables[name];
    delete this.bundle.counts[name];
    await this.commit();
  }

  /**
   * Replaces the whole bound file with an already-built bundle. Used by the
   * bind-on-export path, where the bundle text exists before the file does.
   */
  async writeBundleText(text: string): Promise<void> {
    this.requireHandle();
    const parsed = parseBundle(text);
    if (!parsed) throw new Error('That text is not a LifeOS bundle, so it was not written.');
    this.bundle = parsed;
    this.loaded = true;
    await this.commit();
  }

  /**
   * Physical write, coalesced. Repeated `write()` calls inside one flush turn
   * into at most one extra file write after the in-flight one finishes,
   * instead of twenty-three serialised `createWritable()` round trips.
   */
  private async commit(): Promise<void> {
    if (this.writing) {
      this.pendingWrite = true;
      await this.writing;
      if (!this.pendingWrite) return;
    }
    this.pendingWrite = false;

    const run = async (): Promise<void> => {
      const handle = this.requireHandle();
      const payload = JSON.stringify({ ...this.bundle, exportedAt: this.bundle.exportedAt || Date.now() }, null, 2);
      let writable: FsWritableStream;
      try {
        writable = await handle.createWritable();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/not allowed|permission|NotAllowedError/i.test(message)) {
          this.status = 'prompt';
          throw new Error(`${handle.name} needs its write permission restored before it can be saved. Press “Reconnect file”.`);
        }
        this.status = 'missing';
        throw new Error(`${handle.name} could not be opened for writing (${message}). Choose the file again in Settings → Storage.`);
      }
      try {
        await writable.write(payload);
        await writable.close();
      } catch (e) {
        throw new Error(`Writing ${handle.name} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.lastWrittenAt = Date.now();
    };

    this.writing = run().finally(() => { this.writing = null; });
    await this.writing;
    if (this.pendingWrite) await this.commit();
  }
}

/** Parses a `lifeos.json` transport bundle defensively. */
function parseBundle(text: string): BundleShape | null {
  if (!text || !text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed as Partial<BundleShape>;
  if (candidate.format !== 'lifeos-export' || !candidate.tables || typeof candidate.tables !== 'object') {
    return null;
  }
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(candidate.tables)) {
    if (!Array.isArray(rows)) continue;
    tables[name] = rows;
    counts[name] = rows.length;
  }
  return {
    format: 'lifeos-export',
    schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : SCHEMA_VERSION,
    appVersion: typeof candidate.appVersion === 'string' ? candidate.appVersion : APP_VERSION,
    exportedAt: typeof candidate.exportedAt === 'number' ? candidate.exportedAt : 0,
    tables,
    counts,
  };
}
