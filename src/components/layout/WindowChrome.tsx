import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { SaveIndicator } from '@/components/system/SaveIndicator';

/** True once the main content has scrolled past its large title. */
export function useContentScrolled(threshold = 44): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = document.getElementById('lo-content');
    if (!el) return;
    const on = () => setScrolled(el.scrollTop > threshold);
    on();
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [threshold]);
  return scrolled;
}

/**
 * WindowChrome — the desktop/iPad top bar.
 *
 * Apple navigation-bar behaviour: transparent while the page's large title is
 * visible; once content scrolls beneath it the bar takes on material and a
 * hairline and the inline title fades in. The Live Activity capsule sits in
 * the centre; save state and the clock on the right.
 */
export function WindowChrome({
  title,
  actions,
  center,
}: {
  title: string;
  actions?: ReactNode;
  center?: ReactNode;
}) {
  const scrolled = useContentScrolled();
  return (
    <header
      className={cn(
        'sticky top-0 z-chrome grid h-chrome shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-5',
        'border-b transition-[background-color,border-color,backdrop-filter] duration-slow ease-calm',
        scrolled ? 'material-bar border-line/60' : 'border-transparent bg-surface-base',
      )}
    >
      <h1
        className={cn(
          'truncate text-[0.9375rem] font-semibold tracking-[-0.016em] text-ink transition-[opacity,transform] duration-slow ease-calm',
          scrolled ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        )}
        aria-hidden={!scrolled}
      >
        {title}
      </h1>

      <div className="flex min-w-0 justify-center">{center}</div>

      <div className="flex min-w-0 items-center justify-end gap-3">
        {actions}
        <SaveIndicator />
        <Clock />
      </div>
    </header>
  );
}

/** A live clock + date. Ticks on the minute boundary, not on a 1s interval. */
export function Clock({ className, withDate = false }: { className?: string; withDate?: boolean }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number;
    const schedule = () => {
      const ms = 60_000 - (Date.now() % 60_000);
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, ms + 20);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className={cn('hidden shrink-0 items-center gap-2 pr-1 sm:flex', className)}>
      <time
        dateTime={now.toISOString()}
        className="t-num text-[0.8125rem] font-semibold text-ink"
      >
        {time}
      </time>
      {withDate ? <span className="t-num text-[0.8125rem] text-ink-faint">{date}</span> : <span className="t-meta t-num hidden md:inline">{date}</span>}
    </div>
  );
}
