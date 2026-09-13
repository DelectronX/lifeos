import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Button — the system's primary affordance.
 *
 * Depth is luminance + hairline, never a drop shadow. The accent fill is the
 * only saturated surface in the app and is reserved for the single most
 * important action on a screen.
 *
 * @example
 * <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />}>Add task</Button>
 * <Button variant="secondary" size="sm" loading>Saving</Button>
 * <Button variant="danger" onClick={remove}>Delete</Button>
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const BASE =
  'relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium ' +
  'transition-[background-color,border-color,color,transform,opacity] duration-base ease-calm ' +
  'active:translate-y-px disabled:pointer-events-none disabled:opacity-45';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-contrast shadow-ambient hover:bg-accent/90 active:bg-accent/95',
  secondary:
    'border border-line bg-surface-raised text-ink hover:border-line-strong hover:bg-surface-overlay',
  ghost:
    'text-ink-muted hover:bg-surface-raised hover:text-ink',
  subtle:
    'bg-surface-raised/70 text-ink-muted hover:bg-surface-overlay hover:text-ink',
  danger:
    'bg-critical text-accent-contrast hover:bg-critical/90',
  link:
    'px-0 text-accent underline-offset-4 hover:underline',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1 rounded-[var(--r-xs)] px-2 text-xs',
  sm: 'h-8 gap-1.5 rounded-[var(--r-sm)] px-2.5 text-[0.8125rem]',
  md: 'h-9 gap-2 rounded-[var(--r-md)] px-3.5 text-sm',
  lg: 'h-11 gap-2 rounded-[var(--r-lg)] px-5 text-[0.9375rem]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  /** Swaps the left icon for a spinner and disables the button. */
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary', size = 'md', iconLeft, iconRight, loading,
    fullWidth, className, children, disabled, type = 'button', ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner /> : iconLeft}
      {children}
      {iconRight}
    </button>
  );
});

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70"
    />
  );
}

/**
 * IconButton — a square, label-required icon affordance.
 *
 * @example
 * <IconButton label="Close" onClick={close}><X className="h-4 w-4" /></IconButton>
 */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Required — becomes both aria-label and the native tooltip. */
  label: string;
}

const ICON_BOX: Record<ButtonSize, string> = {
  xs: 'h-6 w-6 rounded-[var(--r-xs)]',
  sm: 'h-8 w-8 rounded-[var(--r-sm)]',
  md: 'h-9 w-9 rounded-[var(--r-md)]',
  lg: 'h-11 w-11 rounded-[var(--r-lg)]',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'sm', label, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        BASE,
        'relative shrink-0 p-0',
        // Invisible hit-area expansion so small icon buttons still meet the
        // ~44px iOS touch-target minimum without changing their visual size
        // on desktop. `before` covers the padding, pointer-events pass
        // through to the button itself since it's the button's own box.
        "before:absolute before:inset-[-6px] before:content-['']",
        VARIANTS[variant],
        ICON_BOX[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/**
 * ButtonGroup — joins buttons into a single hairline-bounded control.
 *
 * @example
 * <ButtonGroup><Button size="sm">Day</Button><Button size="sm">Week</Button></ButtonGroup>
 */
export function ButtonGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'inline-flex items-center overflow-hidden rounded-[var(--r-md)] border border-line bg-surface-raised',
        '[&>*]:rounded-none [&>*]:border-0 [&>*]:bg-transparent [&>*+*]:border-l [&>*+*]:border-line',
        className,
      )}
    >
      {children}
    </div>
  );
}
