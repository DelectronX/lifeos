import { db } from '@/db/db';
import { exportToJson, requestPersistentStorage } from './backupService';
import { getUiState, setUiState } from './settingsService';
import { saveTextAsFile } from '@/storage/adapters/downloadUploadAdapter';

/**
 * Storage guard — everything LifeOS can do to keep browser-only data alive,
 * and an honest report of what the browser is (not) guaranteeing.
 *
 * Data lives in this origin's IndexedDB ("Website Data"). It disappears when:
 *   - the page is opened from a DIFFERENT address (other IP / port / http vs
 *     https) — that is a different, empty origin;
 *   - Safari's tracking prevention deletes script storage of a website not
 *     used for 7 days (does not apply to Home Screen web apps);
 *   - storage pressure evicts a non-persistent origin;
 *   - the user clears Safari history/website data or uses Private Browsing.
 * The only protection against all of these is a backup FILE outside the
 * browser, so this module also drives the "back up to Files" reminder.
 */

export const BACKUP_INTERVAL_DAYS = 7;
const LAST_FILE_BACKUP_KEY = 'backup.lastFileBackupAt';

export interface StorageHealth {
  /** HTTPS or localhost: required for offline mode and persistence. */
  secureContext: boolean;
  /** Launched from the Home Screen (iOS) / installed PWA. */
  standalone: boolean;
  /** The browser promised not to evict this origin. */
  persisted: boolean;
  /** A service worker controls the page → it opens with the server off. */
  offlineReady: boolean;
  /** Last time a backup file was saved outside the browser. */
  lastFileBackupAt: number | null;
  backupDue: boolean;
  /** The database holds nothing the user created yet. */
  empty: boolean;
  origin: string;
  /** The 7-day / Home Screen rules only apply on iPhone and iPad. */
  appleMobile: boolean;
  /** Problems worth showing, most serious first. */
  warnings: Array<{ level: 'critical' | 'caution'; title: string; detail: string }>;
}

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** True when the user has created anything worth losing. */
export async function hasUserData(): Promise<boolean> {
  const counts = await Promise.all([
    db.recurringRules.count(), db.tasks.count(), db.goals.count(), db.activities.count(),
    db.papers.count(), db.xp.count(), db.habits.count(),
  ]);
  return counts.some((n) => n > 0);
}

export async function getStorageHealth(now = Date.now()): Promise<StorageHealth> {
  const secureContext = typeof window !== 'undefined' && window.isSecureContext === true;
  const standalone = isStandalone();
  let persisted = false;
  try { persisted = (await navigator.storage?.persisted?.()) ?? false; } catch { /* unsupported */ }
  const offlineReady = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
  const lastFileBackupAt = await getUiState<number | null>(LAST_FILE_BACKUP_KEY, null);
  const empty = !(await hasUserData());
  const backupDue = !empty && (lastFileBackupAt === null || now - lastFileBackupAt > BACKUP_INTERVAL_DAYS * 86_400_000);

  const appleMobile = isAppleMobile();
  const warnings: StorageHealth['warnings'] = [];
  if (!secureContext) {
    warnings.push({
      level: 'critical',
      title: 'Opened over plain http',
      detail: appleMobile
        ? 'Safari switches off offline mode and protected storage on http addresses. On the PC run "npm run ipad" and open the https address it prints.'
        : 'Offline mode is off on this address. Open LifeOS on localhost or an https address.',
    });
  } else if (appleMobile && !standalone) {
    warnings.push({
      level: 'caution',
      title: 'Running in a Safari tab',
      detail: 'Safari may delete website data it has not seen for 7 days. Tap Share → Add to Home Screen and always open LifeOS from that icon.',
    });
  }
  if (secureContext && !persisted && appleMobile) {
    warnings.push({
      level: 'caution',
      title: 'Storage not protected yet',
      detail: 'The browser may clear this data when space is low. Opening LifeOS from the Home Screen usually grants protection.',
    });
  }
  if (backupDue) {
    warnings.push({
      level: lastFileBackupAt === null ? 'critical' : 'caution',
      title: lastFileBackupAt === null ? 'No backup file yet' : 'Backup is due',
      detail: 'Everything lives only in this browser. Save a backup to Files so a cleared browser never costs you your data.',
    });
  }
  return {
    secureContext, standalone, persisted, offlineReady, lastFileBackupAt, backupDue, empty, appleMobile,
    origin: typeof location !== 'undefined' ? location.origin : '', warnings,
  };
}

/** Called at startup: asks for persistence silently where it is allowed. */
export async function protectStorageAtBoot(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.isSecureContext) return;
    if (await navigator.storage?.persisted?.()) return;
    await requestPersistentStorage();
  } catch { /* best effort */ }
}

/**
 * Saves a full backup outside the browser. On iPad this opens the share
 * sheet → "Save to Files"; elsewhere it downloads the file.
 */
export async function backupToFiles(now = Date.now()): Promise<'shared' | 'downloaded'> {
  const json = await exportToJson({ includeAttachments: false });
  const stamp = new Date(now).toISOString().slice(0, 10);
  const outcome = await saveTextAsFile(`lifeos-backup-${stamp}.json`, json);
  await setUiState(LAST_FILE_BACKUP_KEY, now);
  return outcome === 'shared' ? 'shared' : 'downloaded';
}
