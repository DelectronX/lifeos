import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Kbd — a keyboard key cap.
 *
 * Use for shortcut hints in menus, the palette and tooltips. Pass an array to
 * render a chord (⌘ K) with correct spacing.
 *
 * @example
 * <Kbd>⌘</Kbd><Kbd>K</Kbd>
 * <KbdChord keys={['Ctrl', 'K']} />
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-[var(--r-xs)]',
        'bg-surface-raised/70 px-1 shadow-[0_0.5px_0_rgb(0_0_0/0.2)] dark:bg-white/[0.08]',
        'font-sans text-[0.6875rem] font-medium leading-none text-ink-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A sequence of key caps rendered as one chord. */
export function KbdChord({ keys, className }: { keys: readonly string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`}>{k}</Kbd>
      ))}
    </span>
  );
}
