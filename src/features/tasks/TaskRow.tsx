import { useMemo } from 'react';
import {
  AlertTriangle, CalendarPlus, CheckCircle2, Circle, Copy, Link2, Lock, MoreHorizontal,
  PauseCircle, PlayCircle, RotateCcw, SkipForward, Trash2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Dot } from '@/components/ui/Badge';
import { Menu, type MenuItemSpec } from '@/components/ui/Menu';
import { IconButton } from '@/components/ui/Button';
import { dueLabel, formatDuration, relativeDayLabel, todayKey } from '@/lib/date';
import { isOverdue, nextStatuses } from '@/services/taskService';
import { STATUS_LABELS } from '@/services/taskQuery';
import type { Goal, Task, TaskStatus, Tracker } from '@/types';

const STATUS_TONE: Record<TaskStatus, 'neutral' | 'accent' | 'positive' | 'caution' | 'critical'> = {
  inbox: 'neutral',
  planned: 'accent',
  in_progress: 'accent',
  completed: 'positive',
  skipped: 'caution',
  rescheduled: 'caution',
  cancelled: 'critical',
};

const STATUS_ICON: Partial<Record<TaskStatus, typeof Circle>> = {
  completed: CheckCircle2,
  cancelled: XCircle,
  skipped: SkipForward,
  in_progress: PlayCircle,
};

export interface TaskRowActions {
  onOpen: (task: Task) => void;
  onSetStatus: (task: Task, status: TaskStatus) => void;
  onDelete: (task: Task) => void;
  onDuplicate: (task: Task) => void;
  onSchedule: (task: Task) => void;
  onToggleSelect?: (task: Task) => void;
}

export function TaskRow({
  task, tracker, goal, selected, selectable, actions, blockedByTitles, scheduledMinutes, compact,
}: {
  task: Task;
  tracker?: Tracker;
  goal?: Goal;
  selected?: boolean;
  selectable?: boolean;
  actions: TaskRowActions;
  blockedByTitles?: string[];
  scheduledMinutes?: number;
  compact?: boolean;
}) {
  const today = todayKey();
  const overdue = isOverdue(task, today);
  const done = task.status === 'completed';
  const closed = done || task.status === 'cancelled';
  const blocked = (blockedByTitles?.length ?? 0) > 0;

  const menuItems = useMemo<MenuItemSpec[]>(() => {
    const transitions = nextStatuses(task.status).map<MenuItemSpec>((s) => ({
      label: `Mark ${STATUS_LABELS[s].toLowerCase()}`,
      icon: statusIconFor(s),
      onSelect: () => actions.onSetStatus(task, s),
    }));
    return [
      { label: 'Edit task…', onSelect: () => actions.onOpen(task) },
      { label: 'Schedule…', icon: <CalendarPlus className="h-3.5 w-3.5" />, onSelect: () => actions.onSchedule(task) },
      { label: 'Duplicate', icon: <Copy className="h-3.5 w-3.5" />, onSelect: () => actions.onDuplicate(task) },
      ...transitions.map((t, i) => (i === 0 ? { ...t, separated: true } : t)),
      { label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, separated: true, onSelect: () => actions.onDelete(task) },
    ];
  }, [task, actions]);

  const StatusIcon = STATUS_ICON[task.status] ?? Circle;

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 border-b border-line px-3 py-2.5 transition-colors last:border-b-0',
        selected ? 'bg-accent-soft/60' : 'hover:bg-surface-sunken',
        closed && 'opacity-60',
      )}
    >
      {selectable ? (
        <input
          type="checkbox"
          aria-label={`Select ${task.title}`}
          checked={!!selected}
          onChange={() => actions.onToggleSelect?.(task)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-[rgb(var(--c-accent))]"
        />
      ) : null}

      <button
        type="button"
        aria-label={done ? 'Reopen task' : 'Complete task'}
        title={done ? 'Reopen task' : 'Complete task'}
        onClick={() => actions.onSetStatus(task, done ? 'planned' : 'completed')}
        className={cn(
          'mt-0.5 shrink-0 rounded-full transition-colors',
          done ? 'text-positive' : 'text-ink-faint hover:text-accent',
        )}
      >
        <StatusIcon className="h-[18px] w-[18px]" />
      </button>

      <button
        type="button"
        onClick={() => actions.onOpen(task)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-start gap-2">
          <span className={cn('min-w-0 flex-1 text-sm text-ink', done && 'line-through decoration-1')}>
            {task.title}
          </span>
          {task.deadlineHard && task.dueDate ? (
            <Lock className="mt-0.5 h-3 w-3 shrink-0 text-ink-faint" aria-label="Hard deadline" />
          ) : null}
        </div>

        {!compact && (task.topic || task.notes) ? (
          <div className="t-meta mt-0.5 truncate">{task.topic || task.notes}</div>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {tracker ? (
            <span className="inline-flex items-center gap-1.5 text-2xs text-ink-muted">
              <Dot color={tracker.color} />
              {tracker.name}
            </span>
          ) : null}

          <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABELS[task.status]}</Badge>

          {task.basePriority >= 4 ? (
            <Badge tone={task.basePriority === 5 ? 'critical' : 'caution'}>P{task.basePriority}</Badge>
          ) : null}

          {task.dueDate ? (
            <span className={cn('t-num text-2xs', overdue ? 'font-medium text-critical' : 'text-ink-faint')}>
              {overdue ? dueLabel(task.dueDate, today) : relativeDayLabel(task.dueDate, today)}
            </span>
          ) : null}

          <span className="t-num text-2xs text-ink-faint">
            {formatDuration(task.estimatedMinutes)}
            {task.actualMinutes > 0 ? ` · ${formatDuration(task.actualMinutes)} done` : ''}
          </span>

          {scheduledMinutes ? (
            <span className="t-num text-2xs text-ink-faint">{formatDuration(scheduledMinutes)} blocked</span>
          ) : null}

          {goal ? (
            <span className="inline-flex items-center gap-1 text-2xs text-ink-faint">
              <Link2 className="h-3 w-3" />
              {goal.title}
            </span>
          ) : null}

          {blocked ? (
            <span
              className="inline-flex items-center gap-1 text-2xs text-caution"
              title={`Blocked by: ${blockedByTitles?.join(', ')}`}
            >
              <PauseCircle className="h-3 w-3" />
              Blocked
            </span>
          ) : null}

          {overdue ? (
            <span className="inline-flex items-center gap-1 text-2xs text-critical">
              <AlertTriangle className="h-3 w-3" />
              Overdue
            </span>
          ) : null}

          {!compact && task.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded bg-surface-sunken px-1.5 py-0.5 text-2xs text-ink-faint">#{tag}</span>
          ))}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          label="Schedule task"
          size="xs"
          className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          onClick={() => actions.onSchedule(task)}
        >
          <CalendarPlus className="h-3.5 w-3.5" />
        </IconButton>
        <Menu
          items={menuItems}
          trigger={({ toggle, ref }) => (
            <IconButton
              ref={ref as React.Ref<HTMLButtonElement>}
              label="Task actions"
              size="xs"
              onClick={toggle}
            >
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          )}
        />
      </div>
    </div>
  );
}

function statusIconFor(status: TaskStatus) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="h-3.5 w-3.5" />;
    case 'cancelled': return <XCircle className="h-3.5 w-3.5" />;
    case 'skipped': return <SkipForward className="h-3.5 w-3.5" />;
    case 'in_progress': return <PlayCircle className="h-3.5 w-3.5" />;
    case 'rescheduled': return <RotateCcw className="h-3.5 w-3.5" />;
    default: return <Circle className="h-3.5 w-3.5" />;
  }
}
