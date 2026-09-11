import { useRef, type ReactNode } from 'react';
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
  sm: { track: 'h-7 p-0.5', seg: 'h-6 gap-1 px-2 text-2xs' },
  md: { track: 'h-9 p-1', seg: 'h-7 gap-1.5 px-3 text-[0.8125rem]' },
} as const;

export function SegmentedControl<T extends string>({
  value, onChange, items, size = 'md', iconOnly, fullWidth, className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const s = SIZES[size];

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
        'inline-flex items-center rounded-[var(--r-md)] border border-line bg-surface-sunken',
        s.track,
        fullWidth && 'flex w-full',
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      }}
    >
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
              'inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-[var(--r-sm)] font-medium',
              'transition-[background-color,color,box-shadow] duration-base ease-calm',
              'disabled:pointer-events-none disabled:opacity-45',
              s.seg,
              active
                ? 'bg-surface-raised text-ink shadow-ambient ring-1 ring-inset ring-line'
                : 'text-ink-muted hover:text-ink',
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
