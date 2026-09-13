import { isNativePlatform } from '@/lib/nativeBridge';

/**
 * FocusLockService — Focus Mode password set/verify/clear.
 *
 * SECURITY MODEL:
 *  - Only a SHA-256 hash (+ random salt) of the password is ever stored, never
 *    the plaintext. Verification re-hashes the entered password with the
 *    stored salt and compares hashes.
 *  - Storage is deliberately kept OUT of the app's Settings/Dexie tables and
 *    therefore out of the general JSON export/import bundle — a focus-lock
 *    hash has no business travelling in a portable data backup shared across
 *    devices. It lives in `@capacitor/preferences` on native platforms (guard
 *    via `isNativePlatform()`, same pattern as the rest of the native bridge)
 *    and in `localStorage` as the browser/dev-server fallback.
 *  - There is no recovery path for a forgotten password (it's a one-way
 *    hash) — only reset (clear + set a new one), which the UI must present
 *    honestly rather than pretending to "recover" anything.
 *
 * This module only builds the password infrastructure. The actual Focus Mode
 * lock-screen enforcement UI is a separate, later feature — it will call
 * `verifyFocusPassword` when it exists.
 */

const STORAGE_KEY = 'lifeos.focusLock.v1';

interface StoredFocusLock {
  /** Hex-encoded SHA-256 digest of `salt + password`. */
  hash: string;
  /** Hex-encoded random salt, unique per password. */
  salt: string;
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`);
}

/* ------------------------------------------------------------------ */
/* Storage backend                                                     */
/* ------------------------------------------------------------------ */

async function readStored(): Promise<StoredFocusLock | null> {
  if (isNativePlatform()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      return value ? (JSON.parse(value) as StoredFocusLock) : null;
    } catch {
      return null;
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredFocusLock) : null;
  } catch {
    return null;
  }
}

async function writeStored(value: StoredFocusLock | null): Promise<void> {
  if (isNativePlatform()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      if (value === null) {
        await Preferences.remove({ key: STORAGE_KEY });
      } else {
        await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(value) });
      }
      return;
    } catch {
      /* fall through to localStorage below as a best-effort fallback */
    }
  }
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* private/incognito mode — nothing more we can do */
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export const MIN_FOCUS_PASSWORD_LENGTH = 4;

export function validateFocusPassword(password: string): string | null {
  if (password.length < MIN_FOCUS_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_FOCUS_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export async function hasFocusPassword(): Promise<boolean> {
  return (await readStored()) !== null;
}

/** Sets (or overwrites) the Focus Mode password. Always re-salts. */
export async function setFocusPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  const error = validateFocusPassword(password);
  if (error) return { ok: false, error };
  const salt = randomSaltHex();
  const hash = await hashPassword(password, salt);
  await writeStored({ hash, salt });
  return { ok: true };
}

/** Verifies a candidate password against the stored hash. */
export async function verifyFocusPassword(password: string): Promise<boolean> {
  const stored = await readStored();
  if (!stored) return false;
  const candidate = await hashPassword(password, stored.salt);
  return candidate === stored.hash;
}

/** Removes the Focus Mode password entirely (no password = Focus Mode unlocked). */
export async function clearFocusPassword(): Promise<void> {
  await writeStored(null);
}
