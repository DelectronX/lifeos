import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

/**
 * Lightweight anchored menu. Portalled so it escapes overflow:hidden timeline
 * columns, repositioned to stay inside the viewport, and closed on outside
 * click / Escape / scroll. No dependency, matches the app's calm surfaces.
 */

export interface MenuItemSpec {
  label: string;
  onSelect: () => void | Promise<void>;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a divider above this item. */
  separated?: boolean;
  hint?: string;
}

export function Menu({
  trigger, items, align = 'end', className,
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: (el: HTMLElement | null) => void }) => ReactNode;
  items: MenuItemSpec[];
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const width = 224;
    const estHeight = Math.min(items.length * 34 + 12, 340);
    let left = align === 'end' ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    if (top + estHeight > window.innerHeight - 8) top = Math.max(8, rect.top - estHeight - 6);
    setPos({ top, left });
  }, [open, align, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      {trigger({
        open,
        toggle: () => setOpen((v) => !v),
        ref: (el) => { anchorRef.current = el; },
      })}
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              style={{ top: pos.top, left: pos.left, width: 224 }}
              className={cn(
                'fixed z-[70] max-h-[340px] overflow-y-auto rounded-lg border border-line bg-surface-raised p-1 shadow-pop animate-in-fade',
                className,
              )}
            >
              {items.map((item, i) => (
                <div key={`${item.label}-${i}`}>
                  {item.separated ? <div className="my-1 h-px bg-line" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => { setOpen(false); void item.onSelect(); }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      item.disabled
                        ? 'cursor-not-allowed text-ink-faint'
                        : item.danger
                          ? 'text-critical hover:bg-critical/10'
                          : 'text-ink hover:bg-surface-sunken',
                    )}
                  >
                    {item.icon ? <span className="shrink-0 text-ink-faint">{item.icon}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? <span className="t-meta shrink-0">{item.hint}</span> : null}
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
