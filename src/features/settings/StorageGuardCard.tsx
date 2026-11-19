import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ShieldAlert, ShieldCheck, Download, Upload, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';
import { db } from '@/db/db';
import { backupToFiles, getStorageHealth } from '@/services/storageGuardService';
import { importFromFile } from '@/services/backupService';
import { getUiState, setUiState } from '@/services/settingsService';

const SNOOZE_KEY = 'storageGuard.snoozedUntil';
const SNOOZE_DAYS = 3;

function ago(ts: number | null): string {
  if (!ts) return 'never';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Storage safety.
 *  - `compact` (Home): one slim line, only when something needs attention,
 *    with "Not now" (hides for 3 days). An EMPTY app always shows the
 *    restore line — that is what someone who just lost data needs.
 *  - full (Settings → Data): every check, always visible.
 */
export function StorageGuardCard({ compact = false }: { compact?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const tick = useLiveQuery(async () => `${(await db.settings.get('settings'))?.updatedAt ?? 0}:${await db.recurringRules.count()}:${await db.tasks.count()}`, []);
  const health = useLiveQuery(() => getStorageHealth(), [tick]);
  const snoozedUntil = useLiveQuery(() => getUiState<number>(SNOOZE_KEY, 0), [tick]) ?? 0;
  if (!health) return null;

  const backup = async () => {
    setBusy(true);
    try {
      const how = await backupToFiles();
      toast.success('Backup saved', how === 'shared' ? 'Choose "Save to Files" to keep it outside the browser.' : 'Saved to your downloads.');
    } catch (e) {
      toast.error('Backup failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const restore = async (file: File) => {
    setBusy(true);
    try {
      const res = await importFromFile(file, health.empty ? 'replace' : 'merge');
      if (res.ok) toast.success('Restored', res.message);
      else toast.error('Not restored', res.message);
    } finally {
      setBusy(false);
    }
  };
  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void restore(file);
      }}
    />
  );

  const critical = health.warnings.some((w) => w.level === 'critical');

  if (compact) {
    const snoozed = Date.now() < snoozedUntil;
    if (!health.empty && (health.warnings.length === 0 || snoozed)) return null;
    const headline = health.empty
      ? 'No data here yet — restore a backup or import your schedule.'
      : health.warnings[0]!.title + (health.warnings.length > 1 ? ` · +${health.warnings.length - 1} more` : '');
    return (
      <div
        className={cn(
          'surface-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--r-lg)] py-2.5 pl-3 pr-2.5',
        )}
      >
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', critical || health.empty ? 'bg-caution/15 text-caution' : 'bg-surface-sunken text-ink-muted')}>
          <ShieldAlert className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 text-[0.9375rem] text-ink">{headline}</span>
        <div className="flex items-center gap-1.5">
          {health.empty ? (
            <Button size="sm" variant="primary" iconLeft={<Upload className="h-3.5 w-3.5" />} loading={busy} onClick={() => fileRef.current?.click()}>
              Restore
            </Button>
          ) : health.backupDue ? (
            <Button size="sm" variant="primary" iconLeft={<Download className="h-3.5 w-3.5" />} loading={busy} onClick={() => void backup()}>
              Back up
            </Button>
          ) : null}
          <Link to="/settings?tab=data" className="touch-hit relative rounded-full px-3 py-1.5 text-[0.8125rem] font-semibold text-accent-ink hover:bg-accent/10">
            Details
          </Link>
          {!health.empty ? (
            <button
              type="button"
              aria-label="Not now"
              title={`Not now (hide for ${SNOOZE_DAYS} days)`}
              className="touch-hit relative grid h-8 w-8 place-items-center rounded-full text-ink-faint hover:bg-surface-sunken hover:text-ink"
              onClick={() => void setUiState(SNOOZE_KEY, Date.now() + SNOOZE_DAYS * 86_400_000)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {fileInput}
      </div>
    );
  }

  const ok = health.warnings.length === 0;
  const rows: Array<[string, boolean, string]> = [
    ['Secure address', health.secureContext, health.origin],
    ...(health.appleMobile
      ? [['Opened from Home Screen', health.standalone, health.standalone ? 'Installed app' : 'Safari tab'] as [string, boolean, string]]
      : []),
    ['Works offline', health.offlineReady, health.offlineReady ? 'Saved on this device' : 'Needs the server'],
    ['Storage protected', health.persisted, health.persisted ? 'Browser will keep it' : 'May be cleared when space is low'],
    ['Backup file', !health.backupDue, `Last: ${ago(health.lastFileBackupAt)}`],
  ];

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {ok
          ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-positive" />
          : <ShieldAlert className={cn('mt-0.5 h-5 w-5 shrink-0', critical ? 'text-caution' : 'text-ink-faint')} />}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="text-sm font-medium text-ink">
              {health.empty ? 'No data in this app yet' : ok ? 'Your data is protected' : 'Data safety'}
            </div>
            <p className="t-meta mt-0.5">Everything lives only in this browser. A backup file is your safety net.</p>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {rows.map(([label, good, detail]) => (
              <li key={label} className="flex min-w-0 items-center gap-2 text-xs">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', good ? 'bg-positive' : 'bg-caution')} />
                <span className="text-ink">{label}</span>
                <span className="truncate text-ink-faint">{detail}</span>
              </li>
            ))}
          </ul>
          {health.warnings.length ? (
            <div className="space-y-1 rounded-lg bg-surface-sunken p-3">
              {health.warnings.map((w) => (
                <p key={w.title} className="t-meta">
                  <span className="font-medium text-ink">{w.title}.</span> {w.detail}
                </p>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={health.backupDue ? 'primary' : 'secondary'} loading={busy} iconLeft={<Download className="h-4 w-4" />} onClick={() => void backup()} disabled={health.empty}>
              Back up to Files
            </Button>
            <Button size="sm" variant="secondary" iconLeft={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
              Restore from file
            </Button>
          </div>
        </div>
      </div>
      {fileInput}
    </Card>
  );
}
