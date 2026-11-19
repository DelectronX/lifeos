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

/*
 * Apple button styles:
 *   primary   = filled  (accent fill — one per screen)
 *   secondary = gray    (system fill, label colour)
 *   subtle    = tinted  (accent at 15%, accent label)
 *   ghost     = plain   (no fill until hover)
 *   danger    = destructive tinted
 * Small sizes are capsules; large are rounded rects. Press = 0.97 scale.
 */
const BASE =
  'touch-hit relative inline-flex select-none items-center justify-center whitespace-nowrap font-semibold tracking-[-0.01em] ' +
  'transition-[background-color,color,transform,opacity,box-shadow] duration-base ease-calm ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] hover:brightness-110 active:brightness-95',
  secondary:
    'bg-surface-sunken text-ink hover:bg-line-strong/60',
  ghost:
    'text-ink-muted hover:bg-surface-sunken/70 hover:text-ink',
  subtle:
    'bg-accent/15 text-accent-ink hover:bg-accent/25',
  danger:
    'bg-critical/15 text-critical hover:bg-critical/25',
  link:
    'px-0 font-medium text-accent-ink hover:underline underline-offset-4 active:scale-100',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1 rounded-full px-2.5 text-xs',
  sm: 'h-8 gap-1.5 rounded-full px-3.5 text-[0.8125rem]',
  md: 'h-10 gap-2 rounded-[var(--r-md)] px-4 text-[0.9375rem]',
  lg: 'h-12 gap-2 rounded-[var(--r-lg)] px-6 text-[1.0625rem]',
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
  xs: 'h-7 w-7 rounded-full',
  sm: 'h-8 w-8 rounded-full',
  md: 'h-10 w-10 rounded-full',
  lg: 'h-12 w-12 rounded-full',
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
        'inline-flex items-center overflow-hidden rounded-full bg-surface-sunken p-0.5',
        '[&>*]:rounded-full [&>*]:border-0 [&>*]:bg-transparent',
        className,
      )}
    >
      {children}
    </div>
  );
}
