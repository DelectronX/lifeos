import { useCallback, useMemo, useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Stat } from '@/components/ui/Progress';
import { toast } from '@/state/toastStore';
import { useGoalMap, useTasks, useTrackerMap, useTrackers } from '@/state/useLiveData';
import {
  deleteTask, duplicateTask, isOpen, setTaskStatus,
} from '@/services/taskService';
import {
  EMPTY_FILTER, collectTags, filterTasks, groupTasks, sectionTasks, sortTasks, summarise,
  type TaskFilter, type TaskGroupBy, type TaskSortBy,
} from '@/services/taskQuery';
import { formatDuration, todayKey } from '@/lib/date';
import { TaskDialog, QuickAddTask } from './TaskDialog';
import { TaskRow, type TaskRowActions } from './TaskRow';
import { TaskFilterBar } from './TaskFilterBar';
import { TaskBulkBar } from './TaskBulkBar';
import { ScheduleTaskModal } from './ScheduleTaskModal';
import type { ID, Task, TaskStatus } from '@/types';

type ViewMode = 'sections' | 'list';

export function TasksPage() {
  const tasks = useTasks();
  const trackers = useTrackers();
  const trackerMap = useTrackerMap();
  const goalMap = useGoalMap();
  const today = todayKey();

  const [view, setView] = useState<ViewMode>('sections');
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);
  const [groupBy, setGroupBy] = useState<TaskGroupBy>('due');
  const [sortBy, setSortBy] = useState<TaskSortBy>('smart');
  const [selected, setSelected] = useState<Set<ID>>(new Set());

  const [editing, setEditing] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);

  const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);
  const tags = useMemo(() => collectTags(tasks), [tasks]);
  const goals = useMemo(() => Object.values(goalMap), [goalMap]);

  const filtered = useMemo(
    () => sortTasks(filterTasks(tasks, filter, today), sortBy, today),
    [tasks, filter, sortBy, today],
  );
  const stats = useMemo(() => summarise(tasks, today), [tasks, today]);
  const sections = useMemo(() => sectionTasks(filtered, today), [filtered, today]);

  const groups = useMemo(
    () => groupTasks(
      filtered,
      groupBy,
      {
        trackerName: (id) => trackerMap[id]?.name ?? 'Unknown tracker',
        goalTitle: (id) => goalMap[id]?.title ?? 'Unknown goal',
      },
      today,
    ),
    [filtered, groupBy, trackerMap, goalMap, today],
  );

  const openDialog = useCallback((task: Task | null) => {
    setEditing(task);
    setDialogOpen(true);
  }, []);

  const actions = useMemo<TaskRowActions>(() => ({
    onOpen: (task) => openDialog(task),
    onSetStatus: async (task, status) => {
      await setTaskStatus(task.id, status, { reason: 'Changed from the task list' });
      if (status === 'completed') toast.success('Completed', task.title);
    },
    onDelete: (task) => setDeleting(task),
    onDuplicate: async (task) => {
      const copy = await duplicateTask(task.id);
      if (copy) toast.success('Duplicated', copy.title);
    },
    onSchedule: (task) => setScheduling(task),
    onToggleSelect: (task) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(task.id)) next.delete(task.id); else next.add(task.id);
        return next;
      }),
  }), [openDialog]);

  const renderRow = (task: Task) => {
    const blockedBy = task.dependsOn
      .map((id) => byId[id])
      .filter((t): t is Task => !!t && isOpen(t))
      .map((t) => t.title);
    return (
      <TaskRow
        key={task.id}
        task={task}
        tracker={trackerMap[task.trackerId]}
        goal={task.goalId ? goalMap[task.goalId] : undefined}
        selected={selected.has(task.id)}
        selectable
        actions={actions}
        blockedByTitles={blockedBy}
      />
    );
  };

  const selectedIds = [...selected];

  return (
    <Page
      title="Tasks"
      subtitle="Everything you intend to do, in one place."
      actions={
        <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => openDialog(null)}>
          New task
        </Button>
      }
      toolbar={
        <div className="space-y-4">
          <QuickAddTask onAdded={() => toast.success('Task added')} />
          <TaskFilterBar
            filter={filter}
            onChange={setFilter}
            groupBy={groupBy}
            onGroupBy={setGroupBy}
            sortBy={sortBy}
            onSortBy={setSortBy}
            trackers={trackers}
            goals={goals}
            tags={tags}
            resultCount={filtered.length}
          />
        </div>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card padded={false} className="px-4 py-3"><Stat label="Open" value={stats.open} /></Card>
        <Card padded={false} className="px-4 py-3">
          <Stat label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'critical' : 'default'} />
        </Card>
        <Card padded={false} className="px-4 py-3"><Stat label="Completed" value={stats.completed} tone="positive" /></Card>
        <Card padded={false} className="px-4 py-3">
          <Stat label="Remaining work" value={formatDuration(stats.remainingMinutes)} />
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          variant="pill"
          value={view}
          onChange={setView}
          items={[
            { value: 'sections' as const, label: 'By urgency' },
            { value: 'list' as const, label: 'Grouped list' },
          ]}
        />
        {filtered.length > 0 ? (
          <Button
            variant="link"
            size="xs"
            onClick={() =>
              setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((t) => t.id))))
            }
          >
            {selected.size === filtered.length ? 'Deselect all' : 'Select all'}
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          title="No tasks match"
          description={tasks.length === 0
            ? 'Add your first task with quick add above, or create one with the full form.'
            : 'Try clearing a filter, or switch the date scope to "Any date".'}
          action={<Button variant="primary" onClick={() => openDialog(null)}>New task</Button>}
        />
      ) : view === 'sections' ? (
        <div className="space-y-6">
          <TaskSection title="Overdue" tone="critical" tasks={sections.overdue} render={renderRow} />
          <TaskSection title="Today" tasks={sections.today} render={renderRow} />
          <TaskSection title="Upcoming" tasks={sections.upcoming} render={renderRow} />
          <TaskSection title="No date" tasks={sections.undated} render={renderRow} />
          {filter.includeClosed || filter.statuses.length ? (
            <TaskSection title="Closed" tasks={sections.closed} render={renderRow} />
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="t-section">{group.label}</h2>
                <span className="t-meta t-num">{group.tasks.length}</span>
              </div>
              <Card padded={false} className="overflow-hidden">
                {group.tasks.map(renderRow)}
              </Card>
            </section>
          ))}
        </div>
      )}

      <TaskBulkBar ids={selectedIds} trackers={trackers} onClear={() => setSelected(new Set())} />

      <TaskDialog
        open={dialogOpen}
        task={editing}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
      />

      <ScheduleTaskModal
        open={!!scheduling}
        task={scheduling}
        onClose={() => setScheduling(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        confirmLabel="Delete task"
        title="Delete this task?"
        message={
          <>
            <strong className="text-ink">{deleting?.title}</strong> and its planned schedule blocks will be
            removed. Any completed work already recorded stays in your history.
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          await deleteTask(deleting.id);
          toast.success('Task deleted');
          setDeleting(null);
        }}
      />
    </Page>
  );
}

function TaskSection({
  title, tasks, render, tone,
}: {
  title: string;
  tasks: Task[];
  render: (t: Task) => React.ReactNode;
  tone?: 'critical';
}) {
  if (!tasks.length) return null;
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className={tone === 'critical' ? 't-section text-critical' : 't-section'}>{title}</h2>
        <span className="t-meta t-num">{tasks.length}</span>
      </div>
      <Card padded={false} className="overflow-hidden">
        {tasks.map(render)}
      </Card>
    </section>
  );
}

/** Exported for reuse by Home and the Goal detail page. */
export type { TaskStatus };
