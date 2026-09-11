import {
  forwardRef, useId,
  type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { Check, ChevronDown, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Form primitives.
 *
 * Fields are SUNKEN (a luminance step down) rather than outlined boxes — an OS
 * input well. The accent appears only on focus. Every control is keyboard
 * reachable and shows the system focus ring.
 *
 * @example
 * <Field label="Title" hint="Shown in the task list">
 *   <Input value={v} onChange={(e) => set(e.target.value)} />
 * </Field>
 */

const FIELD_BASE =
  'w-full rounded-[var(--r-md)] border border-line bg-surface-sunken px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-base ease-calm ' +
  'hover:border-line-strong ' +
  'focus:border-accent/70 focus:bg-surface focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-55';

const FIELD_INVALID = 'border-critical/60 focus:border-critical';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error. Wraps its child in a <label>. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  return (
    <label className={cn('block', className)}>
      {label ? (
        <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-ink-muted">
          {label}
          {required ? <span className="text-critical">*</span> : null}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs text-critical">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  sizeVariant?: 'sm' | 'md' | 'lg';
  /** Icon rendered inside the well on the left. Adds left padding. */
  iconLeft?: ReactNode;
  /** Renders numerals with tabular figures — use for times, counts, money. */
  numeric?: boolean;
}

const FIELD_HEIGHT = { sm: 'h-8', md: 'h-9', lg: 'h-11' } as const;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, sizeVariant = 'md', iconLeft, numeric, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        FIELD_BASE,
        FIELD_HEIGHT[sizeVariant],
        numeric && 't-num',
        iconLeft && 'pl-9',
        invalid && FIELD_INVALID,
        className,
      )}
      {...rest}
    />
  );
  if (!iconLeft) return input;
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
        {iconLeft}
      </span>
      {input}
    </span>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(FIELD_BASE, 'resize-y py-2 leading-relaxed', invalid && FIELD_INVALID, className)}
      {...rest}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  sizeVariant?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, sizeVariant = 'md', invalid, children, ...rest },
  ref,
) {
  return (
    <span className="relative block">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          FIELD_BASE,
          FIELD_HEIGHT[sizeVariant],
          'cursor-pointer appearance-none pr-9',
          invalid && FIELD_INVALID,
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
    </span>
  );
});

/**
 * Checkbox — a custom-drawn box so the check mark matches the accent exactly.
 *
 * @example <Checkbox checked={done} onChange={setDone} label="Completed" />
 */
export function Checkbox({
  checked, onChange, label, description, disabled, indeterminate, className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'group inline-flex select-none items-start gap-2.5',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          ref={(el) => { if (el) el.indeterminate = Boolean(indeterminate) && !checked; }}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 h-4 w-4 cursor-[inherit] appearance-none rounded-[5px] border border-line-strong bg-surface-sunken transition-colors duration-fast ease-calm checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent"
        />
        {indeterminate && !checked ? (
          <Minus className="pointer-events-none relative h-3 w-3 text-accent-contrast" strokeWidth={3} />
        ) : (
          <Check
            className="pointer-events-none relative h-3 w-3 scale-75 text-accent-contrast opacity-0 transition-all duration-fast ease-calm peer-checked:scale-100 peer-checked:opacity-100"
            strokeWidth={3.25}
          />
        )}
      </span>
      {(label || description) && (
        <span className="min-w-0">
          {label ? <span className="block text-sm leading-tight text-ink">{label}</span> : null}
          {description ? <span className="t-meta mt-0.5 block">{description}</span> : null}
        </span>
      )}
    </label>
  );
}

/**
 * Radio — a single option in a group. Pass the same `name` to group them.
 *
 * @example
 * <Radio name="mode" value="dark" checked={m === 'dark'} onChange={setM} label="Dark" />
 */
export function Radio<T extends string>({
  name, value, checked, onChange, label, description, disabled, className,
}: {
  name: string;
  value: T;
  checked: boolean;
  onChange: (v: T) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'inline-flex select-none items-start gap-2.5',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => onChange(value)}
          className="peer h-4 w-4 cursor-[inherit] appearance-none rounded-full border border-line-strong bg-surface-sunken transition-colors duration-fast ease-calm checked:border-accent"
        />
        <span className="pointer-events-none absolute h-1.5 w-1.5 scale-0 rounded-full bg-accent transition-transform duration-fast ease-calm peer-checked:scale-100" />
      </span>
      {(label || description) && (
        <span className="min-w-0">
          {label ? <span className="block text-sm leading-tight text-ink">{label}</span> : null}
          {description ? <span className="t-meta mt-0.5 block">{description}</span> : null}
        </span>
      )}
    </label>
  );
}

/** A labelled group of radios with roving arrow-key behaviour from the browser. */
export function RadioGroup<T extends string>({
  legend, value, onChange, options, name, className, orientation = 'vertical',
}: {
  legend?: ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode; description?: ReactNode; disabled?: boolean }>;
  name?: string;
  className?: string;
  orientation?: 'vertical' | 'horizontal';
}) {
  const auto = useId();
  const groupName = name ?? auto;
  return (
    <fieldset className={className}>
      {legend ? <legend className="mb-2 text-xs font-medium text-ink-muted">{legend}</legend> : null}
      <div className={cn('flex gap-3', orientation === 'vertical' ? 'flex-col' : 'flex-wrap items-center gap-4')}>
        {options.map((o) => (
          <Radio
            key={o.value}
            name={groupName}
            value={o.value}
            checked={value === o.value}
            onChange={onChange}
            label={o.label}
            description={o.description}
            disabled={o.disabled}
          />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Toggle — an on/off switch with an optional label + description block.
 *
 * @example
 * <Toggle checked={on} onChange={setOn} label="Auto-plan" description="Fill gaps each morning" />
 */
export function Toggle({
  checked, onChange, label, description, disabled, className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      {(label || description) && (
        <div className="min-w-0">
          {label ? <div className="text-sm font-medium text-ink">{label}</div> : null}
          {description ? <div className="t-meta mt-0.5">{description}</div> : null}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : 'Toggle'}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-slow ease-calm',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-sunken',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-[0.1875rem] h-3 w-3 rounded-full transition-transform duration-slow ease-calm',
            checked ? 'translate-x-[1.1875rem] bg-accent-contrast' : 'translate-x-[0.1875rem] bg-ink-faint',
          )}
        />
      </button>
    </div>
  );
}
