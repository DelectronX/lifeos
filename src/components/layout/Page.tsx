import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Page({
  title, subtitle, actions, children, wide, className, toolbar,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  toolbar?: ReactNode;
}) {
  return (
    <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8', wide ? 'max-w-[100rem]' : 'max-w-6xl', className)}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-display">{title}</h1>
          {subtitle ? <p className="t-muted mt-1">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {toolbar ? <div className="mb-5">{toolbar}</div> : null}
      {children}
    </div>
  );
}

export function PageSection({
  title, description, action, children, className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-8', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="t-title">{title}</h2> : null}
            {description ? <p className="t-muted mt-0.5">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
