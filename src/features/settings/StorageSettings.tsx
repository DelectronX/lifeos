import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, FolderOpen, HardDriveDownload, Loader2, RefreshCw, Save, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Toggle } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import { SettingRow, SettingsSection } from './SettingsSection';
import {
  BUNDLE_FILENAME, FileSystemAccessAdapter, storage, useStorageState,
} from '@/storage';
import { getStoragePreferences, updateStoragePreferences } from '@/services/settingsService';
import type { Settings } from '@/types';

/**
 * Storage settings.
 *
 * The copy here is deliberately blunt about what the current environment can
 * and cannot do. A user running this from an iOS file-manager's built-in
 * server has a completely different save story from someone on desktop Chrome,
 * and pretending otherwise is how people lose data.
 */
export function StorageSettings({ settings }: { settings: Settings }) {
  const state = useStorageState();
  const [busy, setBusy] = useState<string | null>(null);
  const [autoDownload, setAutoDownload] = useState(settings.storage?.autoDownload ?? false);
  const fileInput = useRef<HTMLInputElement>(null);

  const unsaved = state.dirtyCollections.length;

  /* Auto-download: manual mode only, and only when the user opted in. */
  useEffect(() => {
    if (!autoDownload || state.canAutoSave || unsaved === 0) return;
    const minutes = settings.storage?.autoDownloadMinutes ?? 10;
    const id = setTimeout(() => {
      void storage.saveBundleToFile(BUNDLE_FILENAME);
    }, Math.max(1, minutes) * 60_000);
    return () => clearTimeout(id);
  }, [autoDownload, state.canAutoSave, unsaved, settings.storage?.autoDownloadMinutes]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (e) {
      toast.error('Storage error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SettingsSection
        title="Where your data is stored"
        description={
          <>
            LifeOS keeps every table in plain JSON files — one file per type, plus a{' '}
            <code>manifest.json</code> — so your data is readable, portable and syncable. The app
            picks the best way to write those files for wherever it is running.
          </>
        }
        action={<StatusBadge state={state} />}
      >
        <SettingRow label="Active mode" hint={state.adapterDescription}>
          <div className="text-sm font-medium text-ink">{state.adapterLabel}</div>
        </SettingRow>

        <SettingRow label="Saving to" hint="The folder or file your data is written to.">
          <div className="truncate text-sm text-ink-muted" title={state.target}>{state.target}</div>
        </SettingRow>

        <SettingRow
          label="Automatic saving"
          hint={
            state.canAutoSave
              ? 'Changes are written a moment after you make them. Nothing to do.'
              : 'This environment will not let the app write files by itself. You must press Save.'
          }
        >
          <Badge tone={state.canAutoSave ? 'positive' : 'caution'} dot>
            {state.canAutoSave ? 'On' : 'Manual'}
          </Badge>
        </SettingRow>

        <SettingRow label="Last saved" hint={unsaved ? `${unsaved} collection${unsaved === 1 ? '' : 's'} waiting to be written.` : 'Everything is written.'}>
          <div className="text-sm text-ink-muted">
            {state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleString() : 'Not yet'}
          </div>
        </SettingRow>

        {state.lastError ? (
          <div className="flex items-start gap-2 rounded-md border border-critical/25 bg-critical/10 px-3 py-2 text-sm text-critical">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.lastError}</span>
          </div>
        ) : null}

        {state.loadWarnings.length ? (
          <div className="rounded-md border border-caution/25 bg-caution/10 px-3 py-2 text-sm text-caution">
            <div className="font-medium">Some files could not be read at startup</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {state.loadWarnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
            <p className="mt-1">
              Those collections were left as they were — nothing was overwritten. Fix or remove the
              file, or import a bundle below to restore them.
            </p>
          </div>
        ) : null}

        {state.migratedFromIndexedDb ? (
          <div className="rounded-md border border-accent/25 bg-accent/10 px-3 py-2 text-sm text-accent-ink">
            No data files were found, so your existing browser-stored data was used as the starting
            point and has been written out as JSON files. Nothing was lost.
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Save and transfer"
        description={
          state.canAutoSave
            ? 'Saving is automatic, but you can force a write or take a portable copy at any time.'
            : `Press Save (or Ctrl/Cmd+S) to write ${BUNDLE_FILENAME}. Keep that file in your file manager — importing it here restores everything, settings included.`
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            iconLeft={busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            disabled={busy !== null}
            onClick={() =>
              run('save', async () => {
                if (state.canAutoSave) {
                  const ok = await storage.flush();
                  toast[ok ? 'success' : 'error'](ok ? 'Saved' : 'Save failed', ok ? 'Your JSON files are up to date.' : state.lastError ?? '');
                } else {
                  const how = await storage.saveBundleToFile(BUNDLE_FILENAME);
                  toast.success(
                    how === 'shared' ? 'Shared' : 'Downloaded',
                    `${BUNDLE_FILENAME} — keep it somewhere you can find it again.`,
                  );
                }
              })
            }
          >
            {state.canAutoSave ? 'Save now' : `Save ${BUNDLE_FILENAME}`}
          </Button>

          <Button
            iconLeft={<Download className="h-4 w-4" />}
            disabled={busy !== null}
            onClick={() =>
              run('export', async () => {
                await storage.saveBundleToFile(BUNDLE_FILENAME);
                toast.success('Bundle exported', `Everything, including your settings, is in ${BUNDLE_FILENAME}.`);
              })
            }
          >
            Export bundle
          </Button>

          <Button
            iconLeft={<Upload className="h-4 w-4" />}
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
          >
            Import bundle
          </Button>

          {FileSystemAccessAdapter.isAvailable() ? (
            <Button
              iconLeft={<FolderOpen className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() =>
                run('folder', async () => {
                  const adapter = new FileSystemAccessAdapter();
                  const granted = await adapter.requestAccess();
                  if (!granted) {
                    toast.warning('No folder chosen', 'Nothing changed.');
                    return;
                  }
                  await storage.useAdapter(adapter);
                  await updateStoragePreferences({ preferredAdapter: 'fsaccess' });
                  toast.success('Folder connected', 'Your data is now saved into that folder automatically.');
                })
              }
            >
              Choose folder
            </Button>
          ) : null}

          <Button
            iconLeft={<RefreshCw className="h-4 w-4" />}
            disabled={busy !== null}
            onClick={() =>
              run('rewrite', async () => {
                const ok = await storage.saveAll();
                toast[ok ? 'success' : 'error'](ok ? 'All files rewritten' : 'Rewrite failed');
              })
            }
          >
            Rewrite all files
          </Button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            await run('import', async () => {
              const result = await storage.importBundleText(await file.text());
              if (result.ok) {
                toast.success('Imported', result.message);
              } else {
                toast.error('Import failed', result.message);
              }
            });
          }}
        />

        {!state.canAutoSave ? (
          <SettingRow
            label="Download automatically"
            hint="Writes the bundle on a timer while you work, instead of waiting for you to press Save. Some devices show a prompt each time."
          >
            <Toggle
              checked={autoDownload}
              onChange={(next) => {
                setAutoDownload(next);
                void updateStoragePreferences({ autoDownload: next });
              }}
              label="Auto-download"
            />
          </SettingRow>
        ) : null}

        {!state.canAutoSave ? (
          <div className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
            <HardDriveDownload className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Your work is held safely in this app&apos;s local cache between visits, so a refresh
              will not lose it — but the only thing your file manager can see or back up is the{' '}
              <code>{BUNDLE_FILENAME}</code> you save. Save before you clear browser data or move
              devices.
            </span>
          </div>
        ) : null}
      </SettingsSection>
    </>
  );
}

function StatusBadge({ state }: { state: ReturnType<typeof useStorageState> }) {
  if (state.status === 'error') return <Badge tone="critical" dot>Save failed</Badge>;
  if (state.status === 'saving') {
    return (
      <Badge tone="accent">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Saving
      </Badge>
    );
  }
  if (state.dirtyCollections.length > 0) {
    return <Badge tone="caution" dot>Unsaved changes</Badge>;
  }
  return (
    <Badge tone="positive">
      <CheckCircle2 className="mr-1 h-3 w-3" /> Saved
    </Badge>
  );
}

/** Loads the persisted storage preferences once, for the parent page. */
export function useStoragePreferences() {
  const [prefs, setPrefs] = useState<Awaited<ReturnType<typeof getStoragePreferences>> | null>(null);
  useEffect(() => {
    void getStoragePreferences().then(setPrefs);
  }, []);
  return prefs;
}
