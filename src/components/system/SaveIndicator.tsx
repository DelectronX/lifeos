import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Save, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import { modKeyLabel } from '@/lib/platform';
import { toast } from '@/state/toastStore';
import { BUNDLE_FILENAME, storage, useStorageState } from '@/storage';

/**
 * SaveIndicator — the one piece of storage state that belongs in the window
 * chrome rather than buried in Settings.
 *
 * In an environment that can save by itself it is a quiet status dot. In
 * manual-file mode — the likely case, since the app is opened from a file
 * manager — it is a real button, because pressing it is the only thing that
 * turns the user's work into a file they own.
 */
export function SaveIndicator({ className }: { className?: string }) {
  const state = useStorageState();
  const [busy, setBusy] = useState(false);
  const unsaved = state.dirtyCollections.length;

  if (!state.ready) return null;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state.canAutoSave) {
        const ok = await storage.flush();
        if (!ok) toast.error('Save failed', state.lastError ?? 'The target refused the write.');
      } else {
        const how = await storage.saveBundleToFile(BUNDLE_FILENAME);
        toast.success(
          how === 'shared' ? 'Shared' : `Saved ${BUNDLE_FILENAME}`,
          'Keep that file — importing it in Settings › Storage restores everything.',
        );
      }
    } catch (e) {
      toast.error('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const error = state.status === 'error';
  const saving = busy || state.status === 'saving';

  const label = error
    ? 'Save failed'
    : saving
      ? 'Saving…'
      : unsaved
        ? state.canAutoSave ? 'Pending' : 'Unsaved'
        : 'Saved';

  return (
    <button
      type="button"
      onClick={() => void save()}
      title={
        error
          ? state.lastError ?? 'The last save failed.'
          : unsaved
            ? `${unsaved} collection${unsaved === 1 ? '' : 's'} not yet written. ${modKeyLabel()}+S to save.`
            : state.lastSavedAt
              ? `Last saved ${new Date(state.lastSavedAt).toLocaleTimeString()}`
              : 'Nothing to save yet.'
      }
      aria-keyshortcuts={`${modKeyLabel() === '⌘' ? 'Meta' : 'Control'}+S`}
      aria-label={`${label}. Save now.`}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border px-2',
        'text-xs font-medium transition-colors duration-base ease-calm',
        error
          ? 'border-critical/40 bg-critical/10 text-critical'
          : unsaved
            ? 'border-caution/40 bg-caution/10 text-caution hover:border-caution/70'
            : 'border-line bg-surface-sunken text-ink-faint hover:text-ink-muted',
        className,
      )}
    >
      {error ? (
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      ) : saving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : unsaved ? (
        <Save className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Check className="h-3.5 w-3.5" aria-hidden />
      )}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/**
 * Drop a `lifeos.json` anywhere on the window to restore it.
 *
 * Importing is the other half of manual-file mode and a file picker alone is
 * fussy on a tablet, so the whole window is a drop target. The overlay only
 * appears once files are actually being dragged in, so it never gets in the way.
 */
export function BundleDropZone() {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const carriesFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current += 1;
      setOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const onDrop = async (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);

      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!/\.json$/i.test(file.name)) {
        toast.error('Not a LifeOS file', `${file.name} is not a .json bundle.`);
        return;
      }
      try {
        const result = await storage.importBundleText(await file.text());
        if (result.ok) toast.success('Imported', result.message);
        else toast.error('Import failed', result.message);
      } catch (err) {
        toast.error('Import failed', err instanceof Error ? err.message : String(err));
      }
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!over) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-overlay flex items-center justify-center bg-canvas/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-[var(--r-lg)] border-2 border-dashed border-accent/60 bg-surface px-10 py-8 shadow-pop">
        <Upload className="h-8 w-8 text-accent" aria-hidden />
        <div className="text-sm font-semibold text-ink">Drop {BUNDLE_FILENAME} to restore</div>
        <div className="max-w-xs text-center text-xs text-ink-muted">
          This replaces everything currently in the app with the contents of the file.
        </div>
      </div>
    </div>
  );
}
