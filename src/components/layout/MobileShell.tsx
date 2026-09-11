import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MOBILE_OVERFLOW, MOBILE_TABS } from './navigation';
import { IdentityBlock } from './IdentityBlock';
import { Clock } from './WindowChrome';
import { useShell } from './ShellContext';

/**
 * The mobile shell: a compact top bar and a bottom tab bar with a "More"
 * sheet. This is a native-feeling phone layout, not a squeezed desktop —
 * the rail is never rendered below `lg`.
 */

export function MobileTopBar({ title, actions }: { title: string; actions?: ReactNode }) {
  const { openCommandPalette } = useShell();
  return (
    <header
      className={cn(
        'sticky top-0 z-chrome flex h-14 shrink-0 items-center gap-2',
        'border-b border-line bg-surface/90 px-4 shadow-edge backdrop-blur-xl',
        'pt-[env(safe-area-inset-top)]',
      )}
    >
      <h1 className="truncate text-[0.9375rem] font-semibold tracking-[-0.015em] text-ink">
        {title}
      </h1>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">{actions}</div>
      <Clock className="!flex" />
      <button
        type="button"
        aria-label="Search commands"
        onClick={() => openCommandPalette()}
        className="rounded-[var(--r-md)] p-2 text-ink-muted transition-colors duration-base ease-calm hover:bg-surface-raised hover:text-ink"
      >
        <Search className="h-[1.125rem] w-[1.125rem]" />
      </button>
    </header>
  );
}

export function MobileTabBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { pathname } = useLocation();
  const overflowActive = MOBILE_OVERFLOW.some(
    (d) => pathname === d.to || pathname.startsWith(`${d.to}/`),
  );

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-chrome flex items-stretch',
        'border-t border-line bg-surface/95 backdrop-blur-xl lg:hidden',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {MOBILE_TABS.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5',
                'text-[0.625rem] font-medium transition-colors duration-base ease-calm',
                isActive && !moreOpen ? 'text-accent' : 'text-ink-faint',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-0 h-[2px] w-8 rounded-b-full bg-accent transition-opacity duration-base ease-calm',
                    isActive && !moreOpen ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <Icon className="h-[1.125rem] w-[1.125rem]" />
                {item.label}
              </>
            )}
          </NavLink>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-expanded={moreOpen}
        aria-haspopup="dialog"
        className={cn(
          'relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5',
          'text-[0.625rem] font-medium transition-colors duration-base ease-calm',
          moreOpen || overflowActive ? 'text-accent' : 'text-ink-faint',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-0 h-[2px] w-8 rounded-b-full bg-accent transition-opacity duration-base ease-calm',
            moreOpen || overflowActive ? 'opacity-100' : 'opacity-0',
          )}
        />
        <MoreHorizontal className="h-[1.125rem] w-[1.125rem]" />
        More
      </button>
    </nav>
  );
}

/** A bottom sheet holding every destination that did not fit in the tab bar. */
export function MobileMoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useEffect(() => { onClose(); /* close on route change */ }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-overlay lg:hidden" role="presentation">
      <div className="absolute inset-0 bg-[rgb(0_0_0/0.5)] animate-fade" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="More destinations"
        className={cn(
          'absolute inset-x-0 bottom-0 rounded-t-window border-t border-line bg-surface-overlay',
          'shadow-overlay animate-rise pb-[env(safe-area-inset-bottom)] focus:outline-none',
        )}
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <span className="t-label">All destinations</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-[var(--r-sm)] p-1.5 text-ink-faint hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="grid grid-cols-3 gap-1 px-3 pb-3">
          {MOBILE_OVERFLOW.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-col items-center gap-2 rounded-[var(--r-lg)] px-2 py-4 text-center',
                      'text-[0.6875rem] font-medium transition-colors duration-base ease-calm',
                      isActive ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:bg-surface-raised/60',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={cn('h-5 w-5', isActive ? 'text-accent' : 'text-ink-faint')} />
                      <span className="leading-tight">{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-line">
          <IdentityBlock collapsed={false} />
        </div>
      </div>
    </div>
  );
}
