import { create } from 'zustand';
import { getUiState, setUiState } from '@/services/uiStateStore';
import type { ID } from '@/types';

/**
 * focusLockStore — the "locked focus mode" flag.
 *
 * This is deliberately separate from the timer snapshot: locking is an
 * IN-APP UI restriction layered on top of a normal timer session, not a
 * property of the timer itself. It only ever restricts navigation *within
 * this web app* — see LockedFocusOverlay's disclosure copy. It cannot, and
 * does not claim to, invoke iOS's real system-level Guided Access.
 *
 * Persisted (debounced) through the same uiState mirror the timer snapshot
 * uses, so a refresh mid-locked-session keeps the lock engaged rather than
 * quietly dropping the restriction.
 */
const STORAGE_KEY = 'focusLock.active';

interface StoredLock {
  sessionId: ID;
}

interface FocusLockState {
  /** The timer session id this lock guards, or null when unlocked. */
  lockedSessionId: ID | null;
  lock: (sessionId: ID) => void;
  /** Clears the lock. Does not touch the timer session itself. */
  unlock: () => void;
}

function loadInitial(): ID | null {
  try {
    const stored = getUiState<StoredLock | null>(STORAGE_KEY, null);
    return stored?.sessionId ?? null;
  } catch {
    return null;
  }
}

export const useFocusLockStore = create<FocusLockState>((set) => ({
  lockedSessionId: loadInitial(),
  lock: (sessionId) => {
    setUiState(STORAGE_KEY, { sessionId } satisfies StoredLock);
    set({ lockedSessionId: sessionId });
  },
  unlock: () => {
    setUiState(STORAGE_KEY, undefined);
    set({ lockedSessionId: null });
  },
}));
