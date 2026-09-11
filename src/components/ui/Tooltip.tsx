import { cloneElement, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Tooltip — a quiet label for icon-only affordances.
 *
 * Opens on hover AND on keyboard focus, after a short delay, and closes on
 * Escape. It is a CSS-positioned sibling (no portal, no popper dependency) so
 * it costs nothing and never traps focus. The trigger must forward props and
 * a ref — every UI primitive here does.
 *
 * @example
 * <Tooltip label="Analytics" side="right">
 *   <IconButton label="Analytics"><BarChart3 className="h-4 w-4" /></IconButton>
 * </Tooltip>
 */

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

const SIDE_CLASS: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
};

export interface TooltipProps {
  label: ReactNode;
  /** Trailing shortcut hint rendered in a dimmer weight. */
  hint?: ReactNode;
  side?: TooltipSide;
  delayMs?: number;
  /** Set false to render the trigger untouched (e.g. when the rail is open). */
  enabled?: boolean;
  className?: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

export function Tooltip({
  label, hint, side = 'top', delayMs = 220, enabled = true, className, children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const id = useId();

  if (!enabled) return children;

  const show = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delayMs);
  };
  const hide = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  };

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute z-overlay flex items-center gap-1.5 whitespace-nowrap',
            'rounded-[var(--r-sm)] border border-line bg-surface-overlay px-2 py-1',
            'text-2xs font-medium text-ink shadow-pop animate-fade',
            SIDE_CLASS[side],
            className,
          )}
        >
          {label}
          {hint ? <span className="text-ink-faint">{hint}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
