import { SCHEMA_VERSION } from '@/db/db';
import { MANIFEST_NAME, type AdapterId, type StorageEnvelope, type StorageManifest } from './types';

/**
 * Envelope helpers.
 *
 * Every collection file carries a header so a folder full of JSON stays
 * self-describing: you can open `data/tasks.json` in any text editor and see
 * what it is, when it was written and which schema it belongs to.
 */

export const APP_VERSION = '1.0.0';

export function makeEnvelope<T>(
  collection: string,
  records: T[],
  schemaVersion = SCHEMA_VERSION,
  savedAt = Date.now(),
): StorageEnvelope<T> {
  return { format: 'lifeos-collection', schemaVersion, savedAt, collection, records };
}

export function serializeEnvelope<T>(envelope: StorageEnvelope<T>): string {
  return JSON.stringify(envelope, null, 2);
}

export interface ParseResult<T = unknown> {
  ok: boolean;
  envelope: StorageEnvelope<T> | null;
  /** Human-readable reason the file could not be used, when `ok` is false. */
  error: string | null;
}

/**
 * Reads a collection file defensively. A half-written or hand-edited file must
 * produce a clear error and leave the working set untouched — never a crash
 * and never a silent empty table (which would look like data loss).
 *
 * Tolerated shapes, in order:
 *  1. a proper envelope,
 *  2. a bare array of records (an older or hand-made file),
 *  3. anything else -> an error.
 */
export function parseEnvelope<T = unknown>(text: string | null, collection: string): ParseResult<T> {
  if (text === null || text.trim() === '') {
    return { ok: false, envelope: null, error: null }; // absent, not corrupt
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      envelope: null,
      error: `"${collection}" is not valid JSON (${e instanceof Error ? e.message : String(e)}). The file was left untouched.`,
    };
  }

  if (Array.isArray(parsed)) {
    return { ok: true, envelope: makeEnvelope(collection, parsed as T[]), error: null };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, envelope: null, error: `"${collection}" does not contain a JSON object or array.` };
  }

  const candidate = parsed as Partial<StorageEnvelope<T>>;
  if (candidate.format !== 'lifeos-collection') {
    return { ok: false, envelope: null, error: `"${collection}" is not a LifeOS collection file.` };
  }
  if (!Array.isArray(candidate.records)) {
    return { ok: false, envelope: null, error: `"${collection}" has no "records" array.` };
  }

  return {
    ok: true,
    envelope: {
      format: 'lifeos-collection',
      schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 1,
      savedAt: typeof candidate.savedAt === 'number' ? candidate.savedAt : 0,
      collection: typeof candidate.collection === 'string' ? candidate.collection : collection,
      records: candidate.records as T[],
    },
    error: null,
  };
}

export function makeManifest(
  counts: Record<string, number>,
  writtenBy: AdapterId | 'unknown' = 'unknown',
  savedAt = Date.now(),
): StorageManifest {
  return {
    format: 'lifeos-manifest',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    savedAt,
    counts,
    writtenBy,
  };
}

export function parseManifest(text: string | null): StorageManifest | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<StorageManifest>;
    if (parsed?.format !== 'lifeos-manifest') return null;
    return {
      format: 'lifeos-manifest',
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1,
      appVersion: String(parsed.appVersion ?? 'unknown'),
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
      counts: (parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {}) as Record<string, number>,
      writtenBy: (parsed.writtenBy ?? 'unknown') as AdapterId | 'unknown',
    };
  } catch {
    return null;
  }
}

export { MANIFEST_NAME };
