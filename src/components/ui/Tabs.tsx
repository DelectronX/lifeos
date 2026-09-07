import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
}

export function Tabs<T extends string>({
  items, value, onChange, className, variant = 'underline', size = 'md',
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  variant?: 'underline' | 'pill';
  size?: 'sm' | 'md';
}) {
  if (variant === 'pill') {
    return (
      <div className={cn('inline-flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5', className)} role="tablist">
        {items.map((item) => (
          <button
            key={item.value}
            role="tab"
            aria-selected={value === item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 font-medium transition-colors duration-150 ease-calm',
              size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
              value === item.value
                ? 'bg-surface-raised text-ink shadow-sm'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {item.icon}
            {item.label}
            {typeof item.count === 'number' ? (
              <span className="t-num text-2xs text-ink-faint">{item.count}</span>
            ) : null}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-4 border-b border-line overflow-x-auto scrollbar-none', className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            'relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 pt-1 font-medium transition-colors duration-150 ease-calm',
            size === 'sm' ? 'text-xs' : 'text-sm',
            value === item.value
              ? 'border-accent text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          {item.icon}
          {item.label}
          {typeof item.count === 'number' ? (
            <span className="t-num rounded-full bg-surface-sunken px-1.5 py-0.5 text-2xs text-ink-faint">{item.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
