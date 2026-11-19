import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type WidgetTone = 'accent' | 'positive' | 'caution' | 'critical' | 'violet' | 'teal' | 'neutral';

const TONE: Record<WidgetTone, string> = {
  accent: 'bg-accent/15 text-accent-ink',
  positive: 'bg-positive/15 text-positive',
  caution: 'bg-caution/15 text-caution',
  critical: 'bg-critical/15 text-critical',
  violet: 'bg-[rgb(191_90_242/0.15)] text-[rgb(150_70_210)] dark:text-[rgb(214_140_250)]',
  teal: 'bg-[rgb(64_200_224/0.15)] text-[rgb(10_120_140)] dark:text-[rgb(100_215_235)]',
  neutral: 'bg-ink/[0.07] text-ink-muted',
};

/**
 * WidgetShell — one consistent frame for every Home widget.
 *   header  tinted icon well · title · optional link ("View")
 *   body    the widget's own presentation (rings, bars, lists, timelines)
 * Widgets choose *how* to present; the shell keeps spacing, type and states
 * identical so the dashboard reads as one system.
 */
export function WidgetShell({
  title, icon: Icon, tone = 'neutral', href, hrefLabel = 'View', trailing, children, className, bodyClassName,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  tone?: WidgetTone;
  href?: string;
  hrefLabel?: string;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('surface-card flex h-full min-w-0 flex-col rounded-[var(--r-xl)] p-4', className)}>
      <header className="mb-3 flex min-w-0 items-center gap-2.5">
        {Icon ? (
          <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-[8px]', TONE[tone])} aria-hidden>
            <Icon className="h-[0.9375rem] w-[0.9375rem]" strokeWidth={2.1} />
          </span>
        ) : null}
        <h3 className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold tracking-[-0.005em] text-ink">{title}</h3>
        {trailing}
        {href ? (
          <Link to={href} className="inline-flex shrink-0 items-center gap-0.5 rounded-[6px] text-[0.75rem] font-medium text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            {hrefLabel}<ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </header>
      <div className={cn('min-h-0 min-w-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Small inline empty-state for use inside a widget body. */
export function WidgetEmpty({ text, icon: Icon, action }: { text: string; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[5rem] flex-col items-center justify-center gap-2 py-3 text-center">
      {Icon ? <Icon className="h-5 w-5 text-ink-faint" aria-hidden /> : null}
      <p className="max-w-[16rem] text-[0.8125rem] leading-snug text-ink-faint">{text}</p>
      {action}
    </div>
  );
}

/** Loading placeholder: quiet shimmering lines in the widget's shape. */
export function WidgetSkeleton({ lines = 3, metric = false }: { lines?: number; metric?: boolean }) {
  return (
    <div className="space-y-2.5 py-1" aria-busy="true" aria-label="Loading">
      {metric ? <div className="h-7 w-24 animate-pulse rounded-[6px] bg-ink/[0.07]" /> : null}
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3 animate-pulse rounded-full bg-ink/[0.06]" style={{ width: `${90 - i * 14}%`, animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

/** Big tabular metric with a caption, used as a widget's headline. */
export function WidgetMetric({ value, unit, caption, className }: { value: ReactNode; unit?: ReactNode; caption?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="t-num t-rounded text-[1.75rem] font-semibold leading-none tracking-[-0.03em] text-ink">
        {value}{unit ? <span className="ml-0.5 text-[0.875rem] font-medium text-ink-faint">{unit}</span> : null}
      </div>
      {caption ? <div className="mt-1.5 text-[0.75rem] text-ink-muted">{caption}</div> : null}
    </div>
  );
}

/**
 * Per-widget error boundary: one broken widget shows a contained error
 * instead of taking Home down. Logs the error for debugging.
 */
export class WidgetBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[widget] ${this.props.title} failed`, error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="surface-card flex h-full flex-col items-center justify-center gap-2 rounded-[var(--r-xl)] p-4 text-center" role="alert">
        <AlertTriangle className="h-5 w-5 text-caution" aria-hidden />
        <div className="text-[0.8125rem] font-semibold text-ink">{this.props.title} couldn’t load</div>
        <p className="max-w-[16rem] text-[0.75rem] text-ink-faint">{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })} className="text-[0.75rem] font-semibold text-accent-ink hover:underline">Try again</button>
      </section>
    );
  }
}
