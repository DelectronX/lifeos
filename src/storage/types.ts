/**
 * Storage layer contracts.
 *
 * LifeOS used to live entirely inside IndexedDB. It now treats **JSON files**
 * as the source of truth so the data is visible, portable and syncable, while
 * IndexedDB stays as the fast working set the UI queries with live queries.
 *
 * Every concrete backend implements {@link StorageAdapter}. Nothing above this
 * file knows whether the bytes end up on a WebDAV server, in a folder the user
 * picked, or in a download the user saved by hand.
 */

/** Identifier of a backend implementation. */
export type AdapterId =
  | 'http'
  | 'fsaccess'
  | 'indexeddb'
  | 'download'
  | 'memory';

export interface AdapterCapabilities {
  /** Writes land somewhere durable without the user doing anything. */
  canAutoSave: boolean;
  /** Data survives clearing the browser/webview storage. */
  isPersistent: boolean;
  /** Data is visible to the user as real files they can copy or sync. */
  producesRealFiles: boolean;
  /** Short human label shown in Settings, e.g. "WebDAV server". */
  label: string;
  /** One sentence of honest copy about what this mode can and cannot do. */
  description: string;
}

/**
 * A named blob of JSON. `name` is a collection name such as `tasks` or
 * `settings`; the adapter maps it to a file (`data/tasks.json`) or a key.
 */
export interface StorageAdapter {
  readonly id: AdapterId;
  readonly capabilities: AdapterCapabilities;
  /** Where the data physically goes, for display. May change after setup. */
  target(): string;
  /** Returns the raw text of a collection, or null when it does not exist. */
  read(name: string): Promise<string | null>;
  /** Writes (replaces) the raw text of a collection. */
  write(name: string, text: string): Promise<void>;
  /** Collection names currently present. */
  list(): Promise<string[]>;
  /** Removes a collection. Missing collections are not an error. */
  remove(name: string): Promise<void>;
  /**
   * Optional readiness gate: File System Access needs a folder pick and a
   * permission grant, HTTP needs a capability probe. Resolves to false when the
   * adapter cannot be used right now.
   */
  ensureReady?(): Promise<boolean>;
}

/** Envelope written around every collection file. */
export interface StorageEnvelope<T = unknown> {
  /** Format marker, guards against reading an unrelated JSON file. */
  format: 'lifeos-collection';
  /** Dexie schema version the records were written against. */
  schemaVersion: number;
  savedAt: number;
  collection: string;
  records: T[];
}

/** `data/manifest.json` — the index of the folder. */
export interface StorageManifest {
  format: 'lifeos-manifest';
  schemaVersion: number;
  appVersion: string;
  savedAt: number;
  /** collection -> record count, used to spot a truncated folder. */
  counts: Record<string, number>;
  /** Which adapter last wrote here, informational. */
  writtenBy: AdapterId | 'unknown';
}

export const MANIFEST_NAME = 'manifest';
export const BUNDLE_FILENAME = 'lifeos.json';
