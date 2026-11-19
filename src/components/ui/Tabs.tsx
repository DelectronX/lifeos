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
      <div className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[var(--r-md)] bg-surface-sunken p-[3px] scrollbar-none', className)} role="tablist">
        {items.map((item) => (
          <button
            key={item.value}
            role="tab"
            aria-selected={value === item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-[7px] px-3.5 font-medium transition-colors duration-150 ease-calm',
              size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
              value === item.value
                ? 'bg-surface-raised font-semibold text-ink shadow-[0_3px_8px_rgb(0_0_0/0.12)] dark:bg-[rgb(99_99_102)]'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {item.icon}
            {item.label}
            {typeof item.count === 'number' ? (
              <span className="t-num text-2xs opacity-60">{item.count}</span>
            ) : null}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-6 border-b border-line-faint overflow-x-auto scrollbar-none', className)} role="tablist">
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
              ? 'border-ink text-ink'
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
