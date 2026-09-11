import { useEffect, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Kbd } from '@/components/ui/Kbd';
import { modKeyLabel } from '@/lib/platform';
import { SaveIndicator } from '@/components/system/SaveIndicator';
import { useShell } from './ShellContext';

/**
 * WindowChrome — the slim top bar.
 *
 * Reads as OS window chrome, not a page header: module title on the left,
 * a contextual actions slot in the middle-right, then the palette trigger and
 * a live clock/date. Everything numeric is tabular so nothing jitters.
 */
export function WindowChrome({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  const { openCommandPalette } = useShell();

  return (
    <header
      className={cn(
        'sticky top-0 z-chrome flex h-chrome shrink-0 items-center gap-3',
        'border-b border-line bg-surface/90 pl-5 pr-3 shadow-edge backdrop-blur-xl',
      )}
    >
      <h1 className="truncate text-[0.8125rem] font-semibold tracking-[-0.012em] text-ink">
        {title}
      </h1>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {actions}
      </div>

      <SaveIndicator />

      <PaletteTrigger onClick={() => openCommandPalette()} />

      <span className="h-5 w-px shrink-0 bg-line" aria-hidden />

      <Clock />
    </header>
  );
}

function PaletteTrigger({ onClick }: { onClick: () => void }) {
  const mod = modKeyLabel();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts={`${mod === '⌘' ? 'Meta' : 'Control'}+K`}
      className={cn(
        'group inline-flex h-7 shrink-0 items-center gap-2 rounded-[var(--r-md)]',
        'border border-line bg-surface-sunken pl-2 pr-1.5',
        'text-xs text-ink-faint transition-colors duration-base ease-calm',
        'hover:border-line-strong hover:text-ink-muted',
      )}
    >
      <Search className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">Search</span>
      <span className="flex items-center gap-0.5">
        <Kbd>{mod}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

/** A live clock + date. Ticks on the minute boundary, not on a 1s interval. */
export function Clock({ className }: { className?: string }) {
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
        className="t-num text-[0.8125rem] font-medium text-ink"
      >
        {time}
      </time>
      <span className="t-meta t-num hidden md:inline">{date}</span>
    </div>
  );
}
