import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { WidgetShell, WidgetEmpty } from './WidgetShell';
import { useTasks, useTrackerMap } from '@/state/useLiveData';
import { todayKey } from '@/lib/date';
import { Badge, Dot } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { WidgetComponentProps } from './types';

/** Tasks due today (and overdue, not completed/cancelled), soonest first. */
export function TodayTasksWidget(_props: WidgetComponentProps) {
  const today = todayKey();
  const tasks = useTasks();
  const trackerMap = useTrackerMap();

  const dueToday = tasks
    .filter((t) => (t.dueDate === today || (t.dueDate && t.dueDate < today))
      && t.status !== 'completed' && t.status !== 'cancelled')
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

  return (
    <WidgetShell title="Today's Tasks">
      {dueToday.length === 0 ? (
        <WidgetEmpty text="No tasks for today." />
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {dueToday.slice(0, 6).map((task) => {
            const tracker = trackerMap[task.trackerId];
            const overdue = task.dueDate && task.dueDate < today;
            return (
              <li key={task.id}>
                <Link
                  to="/tasks"
                  className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm text-ink hover:bg-surface-sunken"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  {tracker ? <Dot color={tracker.color} /> : null}
                  <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  {overdue ? <Badge tone="critical">Overdue</Badge> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {dueToday.length > 6 ? (
        <Link to="/tasks" className={cn('t-meta mt-2 block hover:text-ink')}>
          +{dueToday.length - 6} more
        </Link>
      ) : null}
    </WidgetShell>
  );
}
