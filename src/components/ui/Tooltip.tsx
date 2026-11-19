import { cloneElement, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

/**
 * Tooltip — a quiet label for icon-only affordances.
 *
 * Opens on hover and on keyboard focus after a short delay; closes on
 * Escape / leave / blur. Portalled to <body> and positioned in viewport
 * coordinates, so no `overflow` ancestor can clip it; flips to the opposite
 * side when there is no room and clamps to an 8px viewport margin.
 *
 * @example
 * <Tooltip label="Analytics" side="right">
 *   <IconButton label="Analytics"><BarChart3 className="h-4 w-4" /></IconButton>
 * </Tooltip>
 */
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

const OPPOSITE: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const GAP = 8, MARGIN = 8;

export interface TooltipProps {
  label: ReactNode;
  /** Trailing shortcut hint rendered in a dimmer weight. */
  hint?: ReactNode;
  side?: TooltipSide;
  delayMs?: number;
  /** Set false to render the trigger untouched. */
  enabled?: boolean;
  className?: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

export function Tooltip({
  label, hint, side = 'bottom', delayMs = 260, enabled = true, className, children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) { setPos(null); return; }
    const a = anchor.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const place = (s: TooltipSide) => {
      if (s === 'top') return { x: a.left + a.width / 2 - t.width / 2, y: a.top - GAP - t.height };
      if (s === 'bottom') return { x: a.left + a.width / 2 - t.width / 2, y: a.bottom + GAP };
      if (s === 'left') return { x: a.left - GAP - t.width, y: a.top + a.height / 2 - t.height / 2 };
      return { x: a.right + GAP, y: a.top + a.height / 2 - t.height / 2 };
    };
    const fits = (p: { x: number; y: number }) => p.x >= MARGIN && p.y >= MARGIN && p.x + t.width <= vw - MARGIN && p.y + t.height <= vh - MARGIN;
    let p = place(side);
    if (!fits(p)) { const q = place(OPPOSITE[side]); if (fits(q)) p = q; }
    p = { x: Math.min(Math.max(MARGIN, p.x), vw - MARGIN - t.width), y: Math.min(Math.max(MARGIN, p.y), vh - MARGIN - t.height) };
    setPos(p);
  }, [open, side, label]);

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
      ref={anchor}
      className="relative inline-flex"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') show(); }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusCapture={(e) => { if ((e.target as HTMLElement).matches?.(':focus-visible')) show(); }}
      onBlurCapture={hide}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {open ? createPortal(
        <span
          ref={tip}
          role="tooltip"
          id={id}
          style={{ position: 'fixed', left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
          className={cn(
            'pointer-events-none z-[90] flex items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2 py-1',
            'border border-ink/10 bg-[rgb(var(--c-surface-overlay))] text-[0.75rem] font-medium text-ink shadow-pop animate-fade',
            className,
          )}
        >
          {label}
          {hint ? <span className="text-ink-faint">{hint}</span> : null}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
