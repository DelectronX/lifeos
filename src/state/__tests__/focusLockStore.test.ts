import { beforeEach, describe, expect, it } from 'vitest';
import { getUiState, resetUiStateForTests } from '@/services/uiStateStore';
import { useFocusLockStore } from '@/state/focusLockStore';

/**
 * Locked Focus Mode's branching state: which session (if any) is currently
 * locked. This is intentionally a thin, independently-testable flag layered
 * on top of the timer snapshot — see LockedFocusOverlay for the honest
 * disclosure copy this flag gates in the UI.
 */
describe('focusLockStore', () => {
  beforeEach(() => {
    resetUiStateForTests();
    useFocusLockStore.setState({ lockedSessionId: null });
  });

  it('starts unlocked', () => {
    expect(useFocusLockStore.getState().lockedSessionId).toBeNull();
  });

  it('lock() records the session id and persists it into uiState', () => {
    useFocusLockStore.getState().lock('ses_123');
    expect(useFocusLockStore.getState().lockedSessionId).toBe('ses_123');
    expect(getUiState<{ sessionId: string } | null>('focusLock.active', null)).toEqual({ sessionId: 'ses_123' });
  });

  it('unlock() clears both the store and the persisted flag', () => {
    useFocusLockStore.getState().lock('ses_123');
    useFocusLockStore.getState().unlock();
    expect(useFocusLockStore.getState().lockedSessionId).toBeNull();
    expect(getUiState<{ sessionId: string } | null>('focusLock.active', null)).toBeNull();
  });

  it('locking a new session overwrites a previous lock rather than stacking', () => {
    useFocusLockStore.getState().lock('ses_1');
    useFocusLockStore.getState().lock('ses_2');
    expect(useFocusLockStore.getState().lockedSessionId).toBe('ses_2');
  });
});
