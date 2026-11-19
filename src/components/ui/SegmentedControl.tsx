import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * SegmentedControl — a small set of mutually exclusive options.
 *
 * An OS segmented control: a sunken track with one raised, hairlined thumb.
 * Implemented as a roving-tabindex radiogroup, so Left/Right (or Up/Down)
 * move the selection and only the active segment is in the tab order.
 *
 * @example
 * <SegmentedControl
 *   value={mode}
 *   onChange={setMode}
 *   items={[
 *     { value: 'dark', label: 'Dark', icon: <Moon className="h-3.5 w-3.5" /> },
 *     { value: 'light', label: 'Light' },
 *     { value: 'system', label: 'Auto' },
 *   ]}
 * />
 */

export interface SegmentedItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Falls back to the label when it is a plain string. */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: ReadonlyArray<SegmentedItem<T>>;
  size?: 'sm' | 'md';
  /** Hides labels, showing icons only. Requires `title` or a string label. */
  iconOnly?: boolean;
  fullWidth?: boolean;
  'aria-label'?: string;
  className?: string;
}

const SIZES = {
  sm: { track: 'h-8 p-[3px]', seg: 'h-[1.625rem] gap-1 px-2.5 text-xs' },
  md: { track: 'h-9 p-[3px]', seg: 'h-[1.875rem] gap-1.5 px-3.5 text-[0.8125rem]' },
} as const;

export function SegmentedControl<T extends string>({
  value, onChange, items, size = 'md', iconOnly, fullWidth, className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const s = SIZES[size];
  // Sliding thumb: measured from the active segment so it glides between options.
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>(`[data-seg="${CSS.escape(value)}"]`);
    if (!el) { setThumb(null); return; }
    const update = () => setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(ref.current!);
    return () => ro?.disconnect();
  }, [value, items.length]);

  const move = (delta: number) => {
    const enabled = items.filter((i) => !i.disabled);
    if (!enabled.length) return;
    const at = Math.max(0, enabled.findIndex((i) => i.value === value));
    const next = enabled[(at + delta + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    requestAnimationFrame(() => {
      ref.current
        ?.querySelector<HTMLButtonElement>(`[data-seg="${CSS.escape(next.value)}"]`)
        ?.focus();
    });
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex max-w-full items-center overflow-x-auto rounded-[var(--r-md)] bg-surface-sunken scrollbar-none',
        s.track,
        fullWidth && 'flex w-full',
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      }}
    >
      {thumb ? (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-[3px] top-[3px] rounded-[calc(var(--r-md)-3px)] bg-surface-raised shadow-[0_0_0_0.5px_rgb(0_0_0/0.04),0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] transition-[left,width] duration-slow ease-calm dark:bg-[rgb(99_99_102)] dark:shadow-none"
          style={{ left: thumb.left, width: thumb.width }}
        />
      ) : null}
      {items.map((item) => {
        const active = item.value === value;
        const title = item.title ?? (typeof item.label === 'string' ? item.label : undefined);
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            data-seg={item.value}
            aria-checked={active}
            aria-label={iconOnly ? title : undefined}
            title={title}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative z-[1] inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-[calc(var(--r-md)-3px)]',
              'transition-colors duration-base ease-calm',
              'disabled:pointer-events-none disabled:opacity-45',
              s.seg,
              active ? 'font-semibold text-ink' : 'font-medium text-ink-muted hover:text-ink',
              !thumb && active && 'bg-surface-raised',
            )}
          >
            {item.icon}
            {iconOnly ? null : item.label}
          </button>
        );
      })}
    </div>
  );
}
