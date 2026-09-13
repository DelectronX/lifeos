import { Link } from 'react-router-dom';
import { WidgetShell, WidgetEmpty } from './WidgetShell';
import { useTasks } from '@/state/useLiveData';
import { todayKey, relativeDayLabel } from '@/lib/date';
import { Badge } from '@/components/ui/Badge';
import type { WidgetComponentProps } from './types';

/** The nearest upcoming task due dates, excluding done/cancelled work. */
export function UpcomingDeadlinesWidget(_props: WidgetComponentProps) {
  const today = todayKey();
  const tasks = useTasks();

  const upcoming = tasks
    .filter((t) => t.dueDate && t.dueDate >= today && t.status !== 'completed' && t.status !== 'cancelled')
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

  return (
    <WidgetShell title="Upcoming Deadlines">
      {upcoming.length === 0 ? (
        <WidgetEmpty text="No upcoming deadlines." />
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {upcoming.slice(0, 6).map((task) => (
            <li key={task.id}>
              <Link
                to="/tasks"
                className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5 text-sm text-ink hover:bg-surface-sunken"
              >
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                {task.deadlineHard ? <Badge tone="caution">Hard</Badge> : null}
                <span className="t-num shrink-0 text-xs text-ink-faint">
                  {relativeDayLabel(task.dueDate!, today)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}
