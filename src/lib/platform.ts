import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { getUiState, onUiStateHydrated, setUiState } from '@/services/uiStateStore';

/**
 * Small platform helpers used by the shell and the command palette.
 */

/** True on macOS/iOS, where the palette hint should read ⌘K rather than Ctrl K. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(p);
}

/** The modifier glyph for this platform: `⌘` on Apple, `Ctrl` elsewhere. */
export function modKeyLabel(): string {
  return isApplePlatform() ? '⌘' : 'Ctrl';
}

/** True when the event carries the platform's primary modifier. */
export function hasModKey(e: KeyboardEvent | ReactKeyboardEvent): boolean {
  return isApplePlatform() ? e.metaKey : e.ctrlKey;
}

/**
 * True when focus is inside a text-entry control, so global single-key
 * shortcuts can stand down.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/** Subscribes to a media query and re-renders on change. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? (window.matchMedia?.(query).matches ?? false) : false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    setMatches(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/** `true` below the `lg` breakpoint — the shell's mobile layout threshold. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 1023px)');
}

/**
 * A state value mirrored into `settings.uiState`, and therefore into
 * `data/settings.json`. It is deliberately NOT localStorage: the whole point
 * of the file-storage layer is that a user's preferences travel with their
 * data instead of being stranded in one browser profile.
 *
 * The initial read is synchronous against the hydrated mirror; if the
 * component mounts before storage boot finishes, it re-reads on hydration.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => getUiState(key, initial));

  useEffect(() => onUiStateHydrated(() => setValue(getUiState(key, initial))), [key]);

  const set = (v: T) => {
    setValue(v);
    setUiState(key, v);
  };
  return [value, set];
}
