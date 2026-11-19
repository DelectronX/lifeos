import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Page — every destination's frame.
 *
 * A centred stage. The eyebrow, large title and description sit on the
 * column's axis; actions follow in one floating cluster beneath, so the
 * eye drops straight down the page. The title is picked up by the glass
 * title cluster once it scrolls beneath the chrome. Sections enter on a
 * short stagger.
 */
export function Page({
  title, subtitle, actions, children, wide, className, toolbar, eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  toolbar?: ReactNode;
  /** Small line above the title, e.g. today's date. */
  eyebrow?: ReactNode;
}) {
  return (
    <div className={cn('mx-auto w-full px-5 pb-16 pt-6 sm:px-8 lg:px-10', wide ? 'max-w-[96rem]' : 'max-w-[68rem]', className)}>
      <header className="mb-10 flex flex-col items-center text-center">
        {eyebrow ? (
          <div className="mb-2 inline-flex items-center rounded-full bg-accent/10 px-3 py-1 text-[0.75rem] font-semibold tracking-[0.01em] text-accent-ink">{eyebrow}</div>
        ) : null}
        <h1 className="t-display max-w-3xl text-balance text-[2rem] sm:text-[2.5rem] sm:leading-[1.08]">{title}</h1>
        {subtitle ? <p className="mt-2.5 max-w-2xl text-balance text-[0.9375rem] leading-relaxed text-ink-muted sm:text-[1.0625rem]">{subtitle}</p> : null}
        {actions ? (
          <div className="mt-6 flex max-w-full flex-wrap items-center justify-center gap-2">{actions}</div>
        ) : null}
      </header>
      {toolbar ? <div className="mb-8 flex justify-center">{toolbar}</div> : null}
      <div className="stagger">{children}</div>
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
    <section className={cn('mb-10', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {title ? <h2 className="t-title3">{title}</h2> : null}
            {description ? <p className="t-meta mt-1">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
