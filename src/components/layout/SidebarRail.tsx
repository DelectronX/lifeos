import { NavLink } from 'react-router-dom';
import { PanelLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import { NAV_GROUPS, type NavDestination } from './navigation';
import { useShell } from './ShellContext';

/**
 * SidebarRail — system navigation.
 *
 * Grouped destinations under small uppercase section labels. The active row is
 * marked by a 2px accent bar on the leading edge plus a one-step luminance
 * raise — never a loud filled pill. Collapsing swaps labels for tooltips.
 */
export function SidebarRail({
  identity,
}: {
  /** Pinned to the bottom: avatar + name + level/XP line. */
  identity?: React.ReactNode;
}) {
  const { railCollapsed, setRailCollapsed } = useShell();

  return (
    <aside
      aria-label="Main navigation"
      data-collapsed={railCollapsed}
      style={{ width: railCollapsed ? 'var(--rail-w-collapsed)' : 'var(--rail-w)' }}
      className={cn(
        'hidden shrink-0 flex-col border-r border-line bg-surface pt-safe lg:flex',
        'transition-[width] duration-slow ease-calm',
      )}
    >
      <Brand collapsed={railCollapsed} onToggle={() => setRailCollapsed(!railCollapsed)} />

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 scrollbar-none">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            {railCollapsed ? (
              <div className="mx-2 mb-2 h-px bg-line-faint" role="presentation" />
            ) : (
              <div className="t-label px-2.5 pb-1.5 pt-1">{group.label}</div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <RailRow item={item} collapsed={railCollapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {identity ? (
        <div className="border-t border-line">{identity}</div>
      ) : null}
    </aside>
  );
}

function Brand({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div
      className={cn(
        'flex h-chrome shrink-0 items-center border-b border-line',
        collapsed ? 'justify-center px-0' : 'gap-2.5 pl-4 pr-2',
      )}
    >
      {collapsed ? (
        <Tooltip label="Expand sidebar" side="right">
          <button
            type="button"
            aria-label="Expand sidebar"
            aria-expanded={false}
            onClick={onToggle}
            className="group flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] bg-accent text-[0.6875rem] font-bold text-accent-contrast transition-colors duration-base ease-calm hover:bg-accent/85"
          >
            <span className="group-hover:hidden">L</span>
            <PanelLeft className="hidden h-3.5 w-3.5 group-hover:block" />
          </button>
        </Tooltip>
      ) : (
        <>
          <div
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-accent text-[0.6875rem] font-bold text-accent-contrast"
          >
            L
          </div>
          <span className="truncate text-[0.8125rem] font-semibold tracking-[-0.012em] text-ink">
            LifeOS
          </span>
          <span className="flex-1" />
          <Tooltip label="Collapse sidebar" side="right">
            <button
              type="button"
              aria-label="Collapse sidebar"
              aria-expanded
              onClick={onToggle}
              className="rounded-[var(--r-sm)] p-1.5 text-ink-faint transition-colors duration-base ease-calm hover:bg-surface-raised hover:text-ink"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

function RailRow({ item, collapsed }: { item: NavDestination; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <Tooltip label={item.label} side="right" enabled={collapsed}>
      <NavLink
        to={item.to}
        end={item.to === '/'}
        title={collapsed ? undefined : item.label}
        className={({ isActive }) =>
          cn(
            'group relative flex h-9 items-center rounded-[var(--r-md)] text-[0.8125rem] font-medium',
            'transition-[background-color,color] duration-base ease-calm',
            collapsed ? 'w-10 justify-center' : 'w-full gap-2.5 px-2.5',
            isActive
              ? 'bg-surface-raised text-ink'
              : 'text-ink-muted hover:bg-surface-raised/60 hover:text-ink',
          )
        }
      >
        {({ isActive }) => (
          <>
            <span
              aria-hidden
              className={cn(
                'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-accent',
                'transition-opacity duration-base ease-calm',
                isActive ? 'opacity-100' : 'opacity-0',
              )}
            />
            <Icon
              className={cn(
                'h-4 w-4 shrink-0 transition-colors duration-base ease-calm',
                isActive ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted',
              )}
            />
            {collapsed ? null : <span className="truncate">{item.label}</span>}
          </>
        )}
      </NavLink>
    </Tooltip>
  );
}
