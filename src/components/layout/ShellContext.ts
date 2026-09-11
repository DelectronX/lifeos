import { createContext, useContext } from 'react';

/**
 * Shell context — lets any descendant open the command palette or read the
 * chrome state, without prop-drilling through every route.
 */
export interface ShellContextValue {
  /** Opens the command palette, optionally seeded with a query. */
  openCommandPalette: (query?: string) => void;
  closeCommandPalette: () => void;
  commandPaletteOpen: boolean;
  /** Desktop rail collapsed to icon-only. */
  railCollapsed: boolean;
  setRailCollapsed: (v: boolean) => void;
  /** True below the `lg` breakpoint. */
  isMobile: boolean;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

/** @example const { openCommandPalette } = useShell(); */
export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside <AppShell>');
  return ctx;
}
