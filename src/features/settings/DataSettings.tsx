import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bell, Database, Download, HardDrive, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Toggle } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { toast } from '@/state/toastStore';
import { SettingRow, SettingsSection, clampNumber } from './SettingsSection';
import {
  createSnapshot, deleteSnapshot, downloadExport, eraseAllData, formatBytes,
  getStorageReport, importFromFile, listSnapshots, requestPersistentStorage, restoreSnapshot,
  type ImportResult, type StorageReport,
} from '@/services/backupService';
import {
  describeStatus, getSupport, requestPermission, sendTestNotification, sweep,
} from '@/services/notificationService';
import type { BackupSnapshot, Settings } from '@/types';
import { DEFAULT_BACKUP_PREFERENCES } from '@/types';

export type Patch = (patch: Partial<Omit<Settings, 'id'>>) => void | Promise<void>;

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function NotificationSettings({ settings, onPatch }: { settings: Settings; onPatch: Patch }) {
  const [support, setSupport] = useState(getSupport());
  const notifications = settings.notifications;
  const set = (patch: Partial<Settings['notifications']>) =>
    void onPatch({ notifications: { ...notifications, ...patch } });

  return (
    <SettingsSection
      title="Notifications"
      description={
        <>
          Reminders are generated locally and only fire while a LifeOS tab is open. Nothing is sent
          to a server, because there is no server.
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
        <Bell className="h-4 w-4 shrink-0 text-ink-faint" />
        <span className="flex-1 text-sm text-ink-muted">{describeStatus(settings)}</span>
        {support === 'default' ? (
          <Button
            size="sm"
            onClick={async () => {
              const result = await requestPermission();
              setSupport(result);
              if (result === 'granted') {
                set({ enabled: true });
                toast.success('Notifications allowed');
              } else if (result === 'denied') {
                toast.warning('Permission denied', 'Re-enable it in your browser site settings.');
              }
            }}
          >
            Allow notifications
          </Button>
        ) : null}
        {support === 'granted' ? (
          <Button
            size="sm"
            onClick={() => {
              const ok = sendTestNotification();
              if (!ok) toast.warning('Could not show a notification', 'Your browser or OS may be suppressing them.');
            }}
          >
            Send a test
          </Button>
        ) : null}
      </div>

      <Toggle
        label="Enable reminders"
        description="Master switch. Off means nothing is scheduled at all."
        disabled={support !== 'granted'}
        checked={notifications.enabled}
        onChange={(v) => {
          set({ enabled: v });
          if (v) void sweep();
        }}
      />
      <Toggle
        label="Upcoming blocks"
        description="A heads-up before a scheduled block starts."
        disabled={!notifications.enabled}
        checked={notifications.blockStart}
        onChange={(v) => set({ blockStart: v })}
      />
      <SettingRow label="Lead time (minutes)" hint="How far ahead of the block the reminder fires.">
        <Input
          type="number" min={0} max={60}
          disabled={!notifications.enabled}
          value={notifications.leadMinutes ?? 5}
          onChange={(e) => set({ leadMinutes: clampNumber(e.target.value, 0, 60, 5) })}
        />
      </SettingRow>
      <Toggle
        label="Revisions due"
        description="One daily digest when spaced-repetition items are due."
        disabled={!notifications.enabled}
        checked={notifications.revisionDue}
        onChange={(v) => set({ revisionDue: v })}
      />
      <Toggle
        label="Tasks due today"
        disabled={!notifications.enabled}
        checked={notifications.taskDue ?? false}
        onChange={(v) => set({ taskDue: v })}
      />
      <Toggle
        label="Break finished"
        description="Tells you when a scheduled break is over."
        disabled={!notifications.enabled}
        checked={notifications.breakEnd}
        onChange={(v) => set({ breakEnd: v })}
      />
      <SettingRow label="Daily review reminder hour" hint="0–23, local time.">
        <Input
          type="number" min={0} max={23}
          disabled={!notifications.enabled}
          value={notifications.dailyReviewHour}
          onChange={(e) => set({ dailyReviewHour: clampNumber(e.target.value, 0, 23, 21) })}
        />
      </SettingRow>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Data: export / import / backup                                      */
/* ------------------------------------------------------------------ */

export function DataSettings({ settings, onPatch }: { settings: Settings; onPatch: Patch }) {
  const backup = { ...DEFAULT_BACKUP_PREFERENCES, ...(settings.backup ?? {}) };
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [restoring, setRestoring] = useState<BackupSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setSnapshots(await listSnapshots());
    setStorage(await getStorageReport());
  };

  useEffect(() => { void refresh(); }, []);

  const totalRows = storage
    ? Object.values(storage.rowCounts).reduce((s, n) => s + n, 0)
    : 0;

  return (
    <>
      <SettingsSection
        title="Your data"
        description="Everything lives in this browser's IndexedDB. There is no account, no sync and no server — which also means a cleared browser profile takes your data with it, so export regularly."
      >
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
          <HardDrive className="h-4 w-4 shrink-0 text-ink-faint" />
          <span className="flex-1 text-sm text-ink-muted">
            {totalRows.toLocaleString()} records stored
            {storage?.usageBytes != null ? ` · ${formatBytes(storage.usageBytes)} used` : ''}
            {storage?.quotaBytes != null ? ` of ${formatBytes(storage.quotaBytes)} available` : ''}
          </span>
          <Badge tone={storage?.persisted ? 'positive' : 'caution'}>
            {storage?.persisted ? 'Persistent' : 'Evictable'}
          </Badge>
          {!storage?.persisted ? (
            <Button
              size="sm"
              onClick={async () => {
                const ok = await requestPersistentStorage();
                toast[ok ? 'success' : 'warning'](
                  ok ? 'Storage is now persistent' : 'Browser declined',
                  ok
                    ? 'The browser will not evict LifeOS data under storage pressure.'
                    : 'Your browser did not grant persistent storage. Export backups regularly.',
                );
                await refresh();
              }}
            >
              Request persistence
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            iconLeft={<Download className="h-4 w-4" />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const name = await downloadExport({ includeAttachments: true });
                toast.success('Export downloaded', name);
              } catch (e) {
                toast.error('Export failed', e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Export everything (JSON)
          </Button>
          <Button iconLeft={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
            Import from file
          </Button>
          <Button
            iconLeft={<Database className="h-4 w-4" />}
            onClick={async () => {
              const snap = await createSnapshot('manual', 'Manual snapshot from Settings.');
              toast.success('Snapshot saved', `${formatBytes(snap.sizeBytes)} kept in this browser.`);
              await refresh();
            }}
          >
            Take a snapshot now
          </Button>
          <Button variant="danger" iconLeft={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmErase(true)}>
            Erase all data
          </Button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true);
            const result = await importFromFile(file, 'replace');
            setBusy(false);
            setImportResult(result);
            if (result.ok) {
              toast.success('Import complete', result.message);
              await refresh();
            }
          }}
        />

        <p className="t-meta">
          Exports carry a schema-version header, so a backup taken today can still be restored after
          the app's data model changes — older files are migrated forward on import. Imports are
          validated strictly and a safety snapshot is taken first.
        </p>
      </SettingsSection>

      <SettingsSection
        title="Automatic local backups"
        description="Periodic JSON snapshots kept inside IndexedDB. They protect against mistakes in the app, not against losing the browser profile — for that, export to a file."
      >
        <Toggle
          label="Take automatic snapshots"
          checked={backup.autoBackupEnabled}
          onChange={(v) => void onPatch({ backup: { ...backup, autoBackupEnabled: v } })}
        />
        <SettingRow label="Snapshot every (days)">
          <Input
            type="number" min={1} max={30}
            disabled={!backup.autoBackupEnabled}
            value={backup.intervalDays}
            onChange={(e) => void onPatch({ backup: { ...backup, intervalDays: clampNumber(e.target.value, 1, 30, 1) } })}
          />
        </SettingRow>
        <SettingRow label="Snapshots to keep">
          <Input
            type="number" min={1} max={20}
            disabled={!backup.autoBackupEnabled}
            value={backup.keepCount}
            onChange={(e) => void onPatch({ backup: { ...backup, keepCount: clampNumber(e.target.value, 1, 20, 5) } })}
          />
        </SettingRow>

        {snapshots.length === 0 ? (
          <p className="t-meta">No snapshots yet.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {snapshots.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">{new Date(s.at).toLocaleString()}</div>
                  <span className="t-num text-2xs text-ink-faint">
                    {formatBytes(s.sizeBytes)} · schema v{s.schemaVersion} ·{' '}
                    {Object.values(s.tableCounts).reduce((a, b) => a + b, 0)} records
                  </span>
                </div>
                <Badge tone={s.kind === 'auto' ? 'neutral' : s.kind === 'pre_import' ? 'caution' : 'accent'}>
                  {s.kind === 'pre_import' ? 'pre-import' : s.kind}
                </Badge>
                <Button size="xs" iconLeft={<RotateCcw className="h-3 w-3" />} onClick={() => setRestoring(s)}>
                  Restore
                </Button>
                <IconButton
                  label="Delete snapshot"
                  size="xs"
                  onClick={async () => { await deleteSnapshot(s.id); await refresh(); }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-critical" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <ImportReportModal result={importResult} onClose={() => setImportResult(null)} />

      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        danger
        title="Restore this snapshot?"
        confirmLabel="Restore"
        message={
          restoring
            ? `Every table will be replaced with the contents of the snapshot from ${new Date(restoring.at).toLocaleString()}. A safety snapshot of the current state is taken first.`
            : ''
        }
        onConfirm={async () => {
          if (!restoring) return;
          const result = await restoreSnapshot(restoring.id);
          setImportResult(result);
          if (result.ok) toast.success('Snapshot restored', result.message);
          else toast.error('Restore failed', result.message);
          await refresh();
        }}
      />

      <ConfirmDialog
        open={confirmErase}
        onClose={() => setConfirmErase(false)}
        danger
        title="Erase everything?"
        confirmLabel="Erase all data"
        message="Every task, block, goal, session, resource and snapshot in this browser will be deleted permanently. Export first if you are not certain."
        onConfirm={async () => {
          await eraseAllData();
          toast.success('All data erased', 'Reload the page to start from a clean slate.');
          await refresh();
        }}
      />
    </>
  );
}

/** Detailed, per-row error report so a failed import is diagnosable. */
function ImportReportModal({ result, onClose }: { result: ImportResult | null; onClose: () => void }) {
  const errors = result?.report.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = result?.report.issues.filter((i) => i.severity === 'warning') ?? [];

  return (
    <Modal
      open={result !== null}
      onClose={onClose}
      size="lg"
      title={result?.ok ? 'Import complete' : 'Import could not be completed'}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}
    >
      <p className="mb-3 text-sm text-ink">{result?.message}</p>

      {result?.migrationsApplied.length ? (
        <section className="mb-3">
          <h4 className="t-label mb-1">Migrations applied</h4>
          <ul className="space-y-0.5">
            {result.migrationsApplied.map((m) => <li key={m} className="t-meta">{m}</li>)}
          </ul>
        </section>
      ) : null}

      {result?.ok && Object.keys(result.importedCounts).length > 0 ? (
        <section className="mb-3">
          <h4 className="t-label mb-1">Records restored</h4>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(result.importedCounts)
              .filter(([, n]) => n > 0)
              .map(([table, n]) => (
                <Badge key={table} tone="neutral">{table}: {n}</Badge>
              ))}
          </div>
        </section>
      ) : null}

      {errors.length > 0 ? (
        <section className="mb-3">
          <h4 className="t-label mb-1 inline-flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-critical" /> Errors ({errors.length})
          </h4>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {errors.slice(0, 100).map((i, idx) => (
              <li key={idx} className="rounded border border-critical/25 bg-critical/5 px-2 py-1 text-xs text-critical">
                {i.table ? `${i.table}${i.row !== null ? ` row ${i.row}` : ''}: ` : ''}{i.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section>
          <h4 className="t-label mb-1">Warnings ({warnings.length})</h4>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto">
            {warnings.slice(0, 100).map((i, idx) => (
              <li key={idx} className="t-meta">
                {i.table ? `${i.table}: ` : ''}{i.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result?.safetySnapshotId ? (
        <p className="t-meta mt-3">
          A snapshot of the previous state was saved before this import — restore it from the
          snapshot list if this was a mistake.
        </p>
      ) : null}
    </Modal>
  );
}
