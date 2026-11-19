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

  // Second pass with the real panel height (collision handling), then focus the first item.
  useLayoutEffect(() => {
    if (!open || !pos || !panelRef.current || !anchorRef.current) return;
    const h = panelRef.current.offsetHeight;
    const rect = anchorRef.current.getBoundingClientRect();
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    if (Math.abs(top - pos.top) > 1) setPos({ ...pos, top });
    panelRef.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [open, pos]);

  const onPanelKey = (e: React.KeyboardEvent) => {
    const btns = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => { e.preventDefault(); btns[(n + btns.length) % btns.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(btns.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); anchorRef.current?.focus(); } };
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
              onKeyDown={onPanelKey}
              style={{ top: pos.top, left: pos.left, width: 224 }}
              className={cn(
                'panel fixed z-[75] max-h-[min(340px,calc(100dvh-16px))] min-w-[13rem] overflow-y-auto rounded-[12px] p-1 animate-in-pop',
                className,
              )}
            >
              {items.map((item, i) => (
                <div key={`${item.label}-${i}`}>
                  {item.separated ? <div className="mx-2 my-1 h-px bg-ink/10" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => { setOpen(false); void item.onSelect(); }}
                    className={cn(
                      'flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[0.8125rem] transition-colors focus:outline-none',
                      item.disabled
                        ? 'cursor-not-allowed text-ink-faint'
                        : item.danger
                          ? 'text-critical hover:bg-critical/12 focus-visible:bg-critical/12'
                          : 'text-ink hover:bg-ink/[0.07] focus-visible:bg-ink/[0.07]',
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
