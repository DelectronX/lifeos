import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, ChevronDown, ChevronUp, Link2, Plus, Trash2,
} from 'lucide-react';
import { Page, PageSection } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Dot } from '@/components/ui/Badge';
import { ProgressBar, Stat } from '@/components/ui/Progress';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Field, Input, Checkbox } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import {
  useActivitiesForRange, useGoal, useMilestones, useOpenTasks, useTasks, useTrackerMap,
} from '@/state/useLiveData';
import {
  createMilestone, deleteGoal, deleteMilestone, toggleMilestone, updateMilestone,
} from '@/services/goalService';
import { setTaskStatus, deleteTask, duplicateTask } from '@/services/taskService';
import {
  GOAL_TYPE_HELP, GOAL_TYPE_LABELS, PACE_LABELS, buildGoalTree, linkTasksToGoal, moveMilestone,
  paceTone, progressFromLoaded, unlinkTask,
} from '@/services/goalQuery';
import { dueLabel, relativeDayLabel, todayKey } from '@/lib/date';
import { TaskDialog } from '@/features/tasks/TaskDialog';
import { TaskRow, type TaskRowActions } from '@/features/tasks/TaskRow';
import { ScheduleTaskModal } from '@/features/tasks/ScheduleTaskModal';
import { GoalDialog } from './GoalDialog';
import type { ID, Milestone, Task } from '@/types';

export function GoalDetailPage() {
  const { goalId } = useParams<{ goalId: string }>();
  const navigate = useNavigate();
  const goal = useGoal(goalId);
  const milestones = useMilestones(goalId);
  const allTasks = useTasks();
  const openTasks = useOpenTasks();
  const trackerMap = useTrackerMap();
  const activities = useActivitiesForRange('2000-01-01', todayKey());

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: Task | null; milestoneId: ID | null }>(
    { open: false, task: null, milestoneId: null },
  );
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [deletingMilestone, setDeletingMilestone] = useState<Milestone | null>(null);
  const [linkTarget, setLinkTarget] = useState<{ milestoneId: ID | null } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<ID>>(new Set());

  const tree = useMemo(
    () => (goal ? buildGoalTree(goal, milestones, allTasks) : null),
    [goal, milestones, allTasks],
  );
  const result = useMemo(
    () => (goal ? progressFromLoaded(goal, allTasks, milestones, activities) : null),
    [goal, allTasks, milestones, activities],
  );

  const actions = useMemo<TaskRowActions>(() => ({
    onOpen: (task) => setTaskDialog({ open: true, task, milestoneId: null }),
    onSetStatus: async (task, status) => {
      await setTaskStatus(task.id, status, { reason: 'Changed from the goal page' });
    },
    onDelete: (task) => setDeletingTask(task),
    onDuplicate: async (task) => { await duplicateTask(task.id); toast.success('Duplicated'); },
    onSchedule: (task) => setScheduling(task),
  }), []);

  if (!goalId) return null;
  if (goal === undefined) {
    return <Page title="Goal"><Card><div className="t-muted">Loading…</div></Card></Page>;
  }
  if (!goal || !tree || !result) {
    return (
      <Page title="Goal not found">
        <EmptyState
          title="This goal no longer exists"
          description="It may have been deleted."
          action={<Button variant="primary" onClick={() => navigate('/goals')}>Back to goals</Button>}
        />
      </Page>
    );
  }

  const tracker = trackerMap[goal.trackerId];
  const color = goal.color ?? tracker?.color ?? 'indigo';

  const renderTask = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      tracker={trackerMap[task.trackerId]}
      actions={actions}
      compact
    />
  );

  return (
    <Page
      title={goal.title}
      subtitle={goal.description}
      actions={
        <>
          <Button size="sm" iconLeft={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => navigate('/goals')}>
            All goals
          </Button>
          <Button size="sm" onClick={() => setEditOpen(true)}>Edit goal</Button>
          <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>Delete</Button>
        </>
      }
    >
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          {tracker ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Dot color={color} />{tracker.name}
            </span>
          ) : null}
          <Badge tone="outline">{GOAL_TYPE_LABELS[goal.type]}</Badge>
          <Badge tone={paceTone(result.paceStatus)}>{PACE_LABELS[result.paceStatus]}</Badge>
          {goal.status !== 'active' ? <Badge tone="neutral">{goal.status}</Badge> : null}
        </div>

        <div className="mt-4">
          <ProgressBar value={result.progress} color={color} size="md" />
        </div>

        <p className="t-muted mt-3">{result.summary}</p>
        <p className="t-meta mt-1">{GOAL_TYPE_HELP[goal.type]}</p>

        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
          <Stat label="Progress" value={`${Math.round(result.progress * 100)}%`} />
          <Stat label={result.unitLabel || 'Achieved'} value={`${result.current} / ${result.target}`} />
          <Stat
            label="Days left"
            value={result.daysRemaining === null ? '—' : result.daysRemaining}
            tone={result.daysRemaining !== null && result.daysRemaining < 0 ? 'critical' : 'default'}
            sub={goal.targetDate ? relativeDayLabel(goal.targetDate) : 'No target date'}
          />
          <Stat
            label="Needed / day"
            value={result.requiredPerDay === null ? '—' : `${result.requiredPerDay}`}
            sub={result.requiredPerDay === null ? undefined : result.unitLabel}
          />
        </div>

        {result.breakdown.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3">
            {result.breakdown.map((b) => (
              <span key={b.label} className="t-meta t-num">{b.label}: <strong className="text-ink">{b.value}</strong></span>
            ))}
          </div>
        ) : null}
      </Card>

      <PageSection
        title="Milestones"
        description="Ordered steps. Completing a milestone feeds milestone-type progress."
        action={
          <Button
            size="sm"
            iconLeft={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              const title = milestoneTitle.trim() || 'New milestone';
              void createMilestone(goal.id, title).then(() => {
                setMilestoneTitle('');
                toast.success('Milestone added');
              });
            }}
          >
            Add milestone
          </Button>
        }
      >
        <div className="mb-3 flex gap-2">
          <Input
            value={milestoneTitle}
            onChange={(e) => setMilestoneTitle(e.target.value)}
            placeholder="Milestone title…"
            onKeyDown={async (e) => {
              if (e.key !== 'Enter' || !milestoneTitle.trim()) return;
              await createMilestone(goal.id, milestoneTitle.trim());
              setMilestoneTitle('');
              toast.success('Milestone added');
            }}
          />
        </div>

        {tree.milestones.length === 0 ? (
          <EmptyState
            title="No milestones"
            description="Break the goal into ordered steps, then link tasks to each one."
          />
        ) : (
          <div className="space-y-3">
            {tree.milestones.map((node, index) => {
              const isCollapsed = collapsed.has(node.milestone.id);
              return (
                <Card key={node.milestone.id} padded={false} className="overflow-hidden">
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      aria-label={node.milestone.completedAt ? 'Mark incomplete' : 'Mark complete'}
                      onClick={() => void toggleMilestone(node.milestone.id)}
                      className={
                        node.milestone.completedAt
                          ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-positive text-white'
                          : 'mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-line-strong hover:border-accent'
                      }
                    >
                      {node.milestone.completedAt ? <Check className="h-3 w-3" /> : null}
                    </button>

                    <div className="min-w-0 flex-1">
                      <input
                        value={node.milestone.title}
                        onChange={(e) => void updateMilestone(node.milestone.id, { title: e.target.value })}
                        className="w-full bg-transparent text-sm font-medium text-ink outline-none focus:underline underline-offset-4"
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="t-meta t-num">
                          {node.completedTasks}/{node.tasks.filter((t) => t.status !== 'cancelled').length} tasks
                        </span>
                        <label className="t-meta inline-flex items-center gap-1">
                          Target
                          <input
                            type="date"
                            value={node.milestone.targetDate ?? ''}
                            onChange={(e) => void updateMilestone(node.milestone.id, { targetDate: e.target.value || null })}
                            className="rounded border border-line bg-surface px-1 py-0.5 text-2xs text-ink"
                          />
                        </label>
                        <label className="t-meta inline-flex items-center gap-1">
                          Weight
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={node.milestone.weight}
                            onChange={(e) => void updateMilestone(node.milestone.id, { weight: Math.max(0, Number(e.target.value) || 0) })}
                            className="w-14 rounded border border-line bg-surface px-1 py-0.5 text-2xs text-ink"
                          />
                        </label>
                        {node.milestone.targetDate ? (
                          <span className="t-meta">{dueLabel(node.milestone.targetDate)}</span>
                        ) : null}
                      </div>
                      {node.tasks.length > 0 ? (
                        <ProgressBar value={node.taskProgress} color={color} size="xs" className="mt-2" />
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <IconButton
                        label="Move up"
                        size="xs"
                        disabled={index === 0}
                        onClick={() => void moveMilestone(goal.id, node.milestone.id, -1)}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label="Move down"
                        size="xs"
                        disabled={index === tree.milestones.length - 1}
                        onClick={() => void moveMilestone(goal.id, node.milestone.id, 1)}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label="Link existing tasks"
                        size="xs"
                        onClick={() => setLinkTarget({ milestoneId: node.milestone.id })}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label="New task in milestone"
                        size="xs"
                        onClick={() => setTaskDialog({ open: true, task: null, milestoneId: node.milestone.id })}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label="Delete milestone"
                        size="xs"
                        variant="danger"
                        onClick={() => setDeletingMilestone(node.milestone)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>

                  {node.tasks.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            if (next.has(node.milestone.id)) next.delete(node.milestone.id);
                            else next.add(node.milestone.id);
                            return next;
                          })
                        }
                        className="w-full border-t border-line px-3 py-1.5 text-left t-meta hover:bg-surface-sunken"
                      >
                        {isCollapsed ? `Show ${node.tasks.length} tasks` : 'Hide tasks'}
                      </button>
                      {!isCollapsed ? <div className="border-t border-line">{node.tasks.map(renderTask)}</div> : null}
                    </>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Tasks on this goal"
        description="Tasks linked to the goal but not to a specific milestone."
        action={
          <div className="flex gap-2">
            <Button size="sm" iconLeft={<Link2 className="h-3.5 w-3.5" />} onClick={() => setLinkTarget({ milestoneId: null })}>
              Link existing
            </Button>
            <Button
              size="sm"
              variant="primary"
              iconLeft={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setTaskDialog({ open: true, task: null, milestoneId: null })}
            >
              New task
            </Button>
          </div>
        }
      >
        {tree.looseTasks.length === 0 ? (
          <EmptyState title="No unassigned tasks" description="Every task on this goal belongs to a milestone." />
        ) : (
          <Card padded={false} className="overflow-hidden">{tree.looseTasks.map(renderTask)}</Card>
        )}
      </PageSection>

      <GoalDialog open={editOpen} goal={goal} onClose={() => setEditOpen(false)} />

      <TaskDialog
        open={taskDialog.open}
        task={taskDialog.task}
        onClose={() => setTaskDialog({ open: false, task: null, milestoneId: null })}
        defaults={{
          goalId: goal.id,
          milestoneId: taskDialog.milestoneId ?? undefined,
          trackerId: goal.trackerId,
        }}
      />

      <ScheduleTaskModal open={!!scheduling} task={scheduling} onClose={() => setScheduling(null)} />

      <LinkTasksModal
        open={!!linkTarget}
        onClose={() => setLinkTarget(null)}
        candidates={openTasks.filter((t) => t.goalId !== goal.id || t.milestoneId !== linkTarget?.milestoneId)}
        onConfirm={async (ids) => {
          const n = await linkTasksToGoal(ids, goal.id, linkTarget?.milestoneId ?? null);
          toast.success(`Linked ${n} task${n === 1 ? '' : 's'}`);
          setLinkTarget(null);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        danger
        confirmLabel="Delete goal"
        title="Delete this goal?"
        message="Its milestones are removed. Tasks are detached but kept, along with all recorded history."
        onConfirm={async () => {
          await deleteGoal(goal.id);
          toast.success('Goal deleted');
          navigate('/goals');
        }}
      />

      <ConfirmDialog
        open={!!deletingMilestone}
        onClose={() => setDeletingMilestone(null)}
        danger
        confirmLabel="Delete milestone"
        title="Delete this milestone?"
        message="Tasks under it stay on the goal, just without a milestone."
        onConfirm={async () => {
          if (!deletingMilestone) return;
          await deleteMilestone(deletingMilestone.id);
          toast.success('Milestone deleted');
          setDeletingMilestone(null);
        }}
      />

      <ConfirmDialog
        open={!!deletingTask}
        onClose={() => setDeletingTask(null)}
        danger
        confirmLabel="Delete task"
        title="Delete this task?"
        message={<>“{deletingTask?.title}” and its planned blocks will be removed.</>}
        onConfirm={async () => {
          if (!deletingTask) return;
          await deleteTask(deletingTask.id);
          toast.success('Task deleted');
          setDeletingTask(null);
        }}
      />
    </Page>
  );
}

/** Multi-select picker for attaching existing tasks to a goal/milestone. */
function LinkTasksModal({
  open, onClose, candidates, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  candidates: Task[];
  onConfirm: (ids: ID[]) => void | Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<ID>>(new Set());
  const [search, setSearch] = useState('');

  const shown = candidates.filter((t) => t.title.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Modal
      open={open}
      onClose={() => { setPicked(new Set()); onClose(); }}
      size="md"
      title="Link existing tasks"
      description="Attach open tasks to this goal. Their progress starts counting immediately."
      footer={
        <>
          <Button variant="ghost" onClick={() => { setPicked(new Set()); onClose(); }}>Cancel</Button>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            onClick={async () => { await onConfirm([...picked]); setPicked(new Set()); }}
          >
            Link {picked.size || ''} task{picked.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Search">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by title…" />
        </Field>
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
          {shown.length === 0 ? <div className="t-meta px-1 py-3 text-center">No matching open tasks.</div> : null}
          {shown.map((t) => (
            <div key={t.id} className="rounded px-1 py-1 hover:bg-surface-sunken">
              <Checkbox
                checked={picked.has(t.id)}
                onChange={(v) =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (v) next.add(t.id); else next.delete(t.id);
                    return next;
                  })
                }
                label={<span className="text-xs">{t.title}</span>}
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export { unlinkTask };
