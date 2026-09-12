import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, FileJson, FolderOpen, HardDriveDownload, Link2, Loader2,
  RefreshCw, Save, Unlink, Upload,
} from 'lucide-react';
import { modKeyLabel } from '@/lib/platform';
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
  const [counts, setCounts] = useState<{ name: string; count: number; dirty: boolean }[]>([]);
  const [pasted, setPasted] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const unsaved = state.dirtyCollections.length;

  /* Per-collection counts, refreshed whenever anything is written. */
  useEffect(() => {
    let alive = true;
    void storage.getCollectionCounts().then((rows) => { if (alive) setCounts(rows); });
    return () => { alive = false; };
  }, [state.lastSavedAt, state.dirtyCollections.length]);

  /* Auto-download: manual mode only, and only when the user opted in. */
  useEffect(() => {
    if (!autoDownload || state.canAutoSave || unsaved === 0) return;
    const minutes = settings.storage?.autoDownloadMinutes ?? 10;
    // Debounced, not periodic: the timer restarts on every change, so a burst
    // of edits produces one download once you stop, not one per edit.
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

        {state.considered.length ? (
          <SettingRow
            label="Why this mode"
            hint="Every backend the app tried at startup, best first, and what happened."
          >
            <ul className="space-y-1 text-xs text-ink-muted">
              {state.considered.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <Badge tone={c.id === state.adapterId ? 'positive' : c.available ? 'neutral' : 'caution'}>
                    {c.id}
                  </Badge>
                  <span>{c.id === state.adapterId ? `Chosen. ${c.reason}` : c.reason}</span>
                </li>
              ))}
            </ul>
          </SettingRow>
        ) : null}

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

      <BoundTargetSection state={state} busy={busy} run={run} />

      <SettingsSection
        title="Save and transfer"
        description={
          state.canAutoSave
            ? 'Saving is automatic, but you can force a write or take a portable copy at any time.'
            : `Press Save (or ${modKeyLabel()}+S) to write ${BUNDLE_FILENAME}. It is always that exact filename, so your file manager offers to replace the existing copy rather than adding another one.`
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            iconLeft={busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            disabled={busy !== null}
            onClick={() =>
              run('save', async () => {
                const result = await storage.save();
                toast[result.ok ? 'success' : 'error'](result.ok ? 'Saved' : 'Save failed', result.message);
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
                const how = await storage.saveBundleToFile(BUNDLE_FILENAME);
                toast.success(
                  how === 'shared' ? 'Shared a copy' : 'Copy exported',
                  `A separate copy of ${BUNDLE_FILENAME} — everything, settings included. This does not change where Save writes.`,
                );
              })
            }
          >
            Export a copy
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
          <div className="space-y-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
            <div className="flex items-start gap-2">
              <HardDriveDownload className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <div className="font-medium text-ink">
                  This environment cannot write files on its own.
                </div>
                {state.usesShareSheet ? (
                  <p>
                    Save opens the share sheet with <code>{BUNDLE_FILENAME}</code>. Two taps:
                    choose your file manager, then choose <strong>Replace</strong> over the existing
                    copy. The filename never changes, so there is only ever one file.
                  </p>
                ) : (
                  <p>
                    Save hands you <code>{BUNDLE_FILENAME}</code> — always that exact name, never
                    timestamped — so your file manager offers to replace the existing copy instead
                    of adding <code>lifeos (1).json</code>. Confirm the replace and you are done.
                  </p>
                )}
                <p>
                  Between saves your work lives in this app&apos;s local cache, so a refresh will
                  not lose it, and {modKeyLabel()}+S saves from anywhere. You can restore by
                  importing, dropping a <code>{BUNDLE_FILENAME}</code> onto the window, or pasting
                  its contents below.
                </p>
              </div>
            </div>

            {state.storagePersistence !== 'persisted' ? (
              <div className="flex items-start gap-2 rounded-md border border-caution/25 bg-caution/10 px-3 py-2 text-caution">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {state.storagePersistence === 'denied'
                    ? 'This browser would not promise to keep the local cache'
                    : 'This browser cannot promise to keep the local cache'}
                  . iOS in particular evicts storage for pages that are not on the Home Screen.
                  Add LifeOS to your Home Screen, and save a file whenever you finish a session —
                  the saved <code>{BUNDLE_FILENAME}</code> is the only copy that is genuinely safe.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <details className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
          <summary className="cursor-pointer text-ink-muted">Paste JSON instead of picking a file</summary>
          <textarea
            className="mt-2 h-28 w-full rounded-md border border-line bg-surface-raised p-2 font-mono text-xs text-ink"
            placeholder={`Paste the contents of ${BUNDLE_FILENAME} here, then press Restore.`}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
          />
          <Button
            className="mt-2"
            disabled={busy !== null || pasted.trim() === ''}
            iconLeft={<FileJson className="h-4 w-4" />}
            onClick={() =>
              run('paste', async () => {
                const result = await storage.importBundleText(pasted);
                if (result.ok) {
                  setPasted('');
                  toast.success('Imported', result.message);
                } else {
                  toast.error('Import failed', result.message);
                }
              })
            }
          >
            Restore from pasted JSON
          </Button>
        </details>
      </SettingsSection>

      <SettingsSection
        title="What is in your files"
        description="One JSON file per collection. A collection marked Unsaved has changes that are not on disk yet."
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          {counts.filter((c) => c.count > 0 || c.dirty).map((c) => (
            <div key={c.name} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-ink-muted" title={`${c.name}.json`}>{c.name}</span>
              <span className={c.dirty ? 'font-medium text-caution' : 'text-ink'}>
                {c.count}{c.dirty ? ' •' : ''}
              </span>
            </div>
          ))}
        </div>
        {counts.every((c) => c.count === 0) ? (
          <p className="text-sm text-ink-muted">Nothing stored yet.</p>
        ) : null}
      </SettingsSection>
    </>
  );
}

type StorageStateView = ReturnType<typeof useStorageState>;

/**
 * The bound save target.
 *
 * Only rendered where the concept is real: a browser with the File System
 * Access API, or a file that was bound earlier. Everywhere else (the iOS
 * webview this is mostly used from) showing a "Choose file" button that
 * cannot work would be a lie, so the section simply says so once and gets out
 * of the way.
 */
function BoundTargetSection({
  state, busy, run,
}: {
  state: StorageStateView;
  busy: string | null;
  run: (key: string, action: () => Promise<void>) => Promise<void>;
}) {
  const bound = state.boundTarget;
  const isBound = bound !== null && bound.status !== 'unbound' && bound.status !== 'unsupported';

  if (!state.canBindFile && !isBound) {
    return (
      <SettingsSection
        title="Bound save file"
        description="On a desktop browser, LifeOS can bind one JSON file and overwrite it in place on every Save."
      >
        <div className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Not available here. This browser has no File System Access API, so nothing can be
            written to disk without you confirming it. Saving uses the {BUNDLE_FILENAME} hand-off
            described below, which is the honest best this environment allows. Desktop Chrome,
            Edge and Opera support binding.
          </span>
        </div>
      </SettingsSection>
    );
  }

  const needsReconnect = bound?.status === 'prompt' || bound?.status === 'denied';
  const isMissing = bound?.status === 'missing';

  return (
    <SettingsSection
      title="Bound save file"
      description="Pick one JSON file. Every Save after that overwrites exactly that file — no picker, no prompt, no duplicate copies."
      action={
        isBound ? (
          <Badge tone={bound?.status === 'granted' ? 'positive' : 'caution'} dot>
            {bound?.status === 'granted' ? 'Bound' : needsReconnect ? 'Needs reconnect' : 'File missing'}
          </Badge>
        ) : (
          <Badge tone="neutral">Not bound</Badge>
        )
      }
    >
      <SettingRow label="File" hint={bound?.message ?? ''}>
        <div className="truncate text-sm font-medium text-ink" title={bound?.filename ?? ''}>
          {bound?.filename ?? 'None yet'}
        </div>
      </SettingRow>

      {isBound ? (
        <SettingRow label="Last written" hint="When this file was last overwritten in place.">
          <div className="text-sm text-ink-muted">
            {bound?.lastWrittenAt ? new Date(bound.lastWrittenAt).toLocaleString() : 'Not yet in this session'}
          </div>
        </SettingRow>
      ) : null}

      {needsReconnect || isMissing ? (
        <div className="flex items-start gap-2 rounded-md border border-caution/25 bg-caution/10 px-3 py-2 text-sm text-caution">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{bound?.message}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {needsReconnect ? (
          <Button
            variant="primary"
            iconLeft={<RefreshCw className="h-4 w-4" />}
            disabled={busy !== null}
            onClick={() =>
              run('reconnect', async () => {
                const result = await storage.reconnectSaveFile();
                toast[result.ok ? 'success' : 'error'](
                  result.ok ? 'Reconnected' : 'Still not connected',
                  result.message,
                );
              })
            }
          >
            Reconnect file
          </Button>
        ) : null}

        {state.canBindFile ? (
          <Button
            variant={isBound ? 'secondary' : 'primary'}
            iconLeft={<Link2 className="h-4 w-4" />}
            disabled={busy !== null}
            onClick={() =>
              run('bind', async () => {
                const result = await storage.bindSaveFile();
                toast[result.ok ? 'success' : 'warning'](
                  result.ok ? 'File bound' : 'Not bound',
                  result.message,
                );
              })
            }
          >
            {isBound ? 'Change file' : 'Choose file'}
          </Button>
        ) : null}

        {isBound ? (
          <Button
            iconLeft={<Unlink className="h-4 w-4" />}
            disabled={busy !== null}
            onClick={() =>
              run('unbind', async () => {
                toast.success('Unbound', await storage.unbindSaveFile());
              })
            }
          >
            Unbind
          </Button>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function StatusBadge({ state }: { state: StorageStateView }) {
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
