import { useSyncExternalStore } from 'react';
import { storage, type StorageState } from './repository';

/**
 * Boot + React glue.
 *
 * `bootStorage()` runs once before the app renders data: it picks an adapter,
 * hydrates the working set from JSON files and installs the mutation hooks.
 * `useStorageState()` gives any component the live save status.
 */

let bootPromise: Promise<StorageState> | null = null;

export function bootStorage(): Promise<StorageState> {
  if (!bootPromise) bootPromise = storage.init();
  return bootPromise;
}

export function useStorageState(): StorageState {
  return useSyncExternalStore(
    (listener) => storage.subscribe(() => listener()),
    () => storage.getState(),
    () => storage.getState(),
  );
}

/**
 * Guards against losing work in manual-file mode.
 *
 * When the adapter cannot auto-save, closing the tab with unsaved changes
 * would throw the work away, so the browser's confirmation dialog is armed.
 * Also binds Ctrl/Cmd+S to a save, because that is what everyone's fingers do.
 */
export function installUnsavedGuard(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    const state = storage.getState();
    if (state.canAutoSave || state.dirtyCollections.length === 0) return;
    event.preventDefault();
    event.returnValue = '';
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    void storage.save();
  };

  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('keydown', onKeyDown);
  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('keydown', onKeyDown);
  };
}
