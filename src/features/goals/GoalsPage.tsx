import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Target } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, Dot } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/Progress';
import { Tabs } from '@/components/ui/Tabs';
import {
  useActivitiesForRange, useGoals, useMilestones, useTasks, useTrackerMap,
} from '@/state/useLiveData';
import {
  GOAL_TYPE_LABELS, PACE_LABELS, countGoal, paceTone, progressFromLoaded,
} from '@/services/goalQuery';
import { relativeDayLabel, todayKey } from '@/lib/date';
import { GoalDialog } from './GoalDialog';
import type { Goal, GoalStatus } from '@/types';

type Scope = 'active' | 'all' | 'completed';

export function GoalsPage() {
  const goals = useGoals(false);
  const milestones = useMilestones();
  const tasks = useTasks();
  const trackerMap = useTrackerMap();
  // Goal progress for metric/time/habit goals derives from the Activity log;
  // a wide window keeps historical totals honest without loading everything.
  const activities = useActivitiesForRange('2000-01-01', todayKey());

  const [scope, setScope] = useState<Scope>('active');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);

  const visible = useMemo(() => {
    const filtered = goals.filter((g) =>
      scope === 'all' ? true : scope === 'completed' ? g.status === 'completed' : g.status === 'active',
    );
    return filtered.sort((a, b) => {
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus) return byStatus;
      if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
      if (a.targetDate) return -1;
      if (b.targetDate) return 1;
      return b.weight - a.weight;
    });
  }, [goals, scope]);

  const counts = useMemo(
    () => ({
      active: goals.filter((g) => g.status === 'active').length,
      all: goals.length,
      completed: goals.filter((g) => g.status === 'completed').length,
    }),
    [goals],
  );

  return (
    <Page
      title="Goals"
      subtitle="Outcomes, the milestones that get you there, and the tasks beneath them."
      actions={
        <Button
          variant="primary"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => { setEditing(null); setDialogOpen(true); }}
        >
          New goal
        </Button>
      }
      toolbar={
        <Tabs
          variant="pill"
          value={scope}
          onChange={setScope}
          items={[
            { value: 'active' as const, label: 'Active', count: counts.active },
            { value: 'completed' as const, label: 'Completed', count: counts.completed },
            { value: 'all' as const, label: 'All', count: counts.all },
          ]}
        />
      }
    >
      {visible.length === 0 ? (
        <EmptyState
          icon={<Target className="h-8 w-8" />}
          title={goals.length === 0 ? 'No goals yet' : 'Nothing in this view'}
          description={
            goals.length === 0
              ? 'A goal groups milestones and tasks and computes its own progress from what you actually complete.'
              : 'Switch to "All" to see paused or abandoned goals.'
          }
          action={
            <Button variant="primary" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              Create a goal
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((goal) => {
            const result = progressFromLoaded(goal, tasks, milestones, activities);
            const c = countGoal(goal, milestones, tasks);
            const tracker = trackerMap[goal.trackerId];
            return (
              <Card key={goal.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/goals/${goal.id}`} className="min-w-0 flex-1">
                    <div className="t-section truncate hover:underline underline-offset-4">{goal.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {tracker ? (
                        <span className="inline-flex items-center gap-1.5 text-2xs text-ink-muted">
                          <Dot color={goal.color ?? tracker.color} />{tracker.name}
                        </span>
                      ) : null}
                      <Badge tone="outline">{GOAL_TYPE_LABELS[goal.type]}</Badge>
                      {goal.status !== 'active' ? <Badge tone="neutral">{goal.status}</Badge> : null}
                    </div>
                  </Link>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => { setEditing(goal); setDialogOpen(true); }}
                  >
                    Edit
                  </Button>
                </div>

                <div className="mt-4">
                  <ProgressBar
                    value={result.progress}
                    color={goal.color ?? tracker?.color ?? 'indigo'}
                    showLabel
                    label={`${result.current} / ${result.target} ${result.unitLabel}`.trim()}
                  />
                </div>

                <p className="t-meta mt-2 line-clamp-2">{result.summary}</p>

                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3">
                  <Badge tone={paceTone(result.paceStatus)}>{PACE_LABELS[result.paceStatus]}</Badge>
                  {goal.targetDate ? (
                    <span className="t-meta t-num">Target {relativeDayLabel(goal.targetDate)}</span>
                  ) : null}
                  {c.milestones ? (
                    <span className="t-meta t-num">{c.milestonesDone}/{c.milestones} milestones</span>
                  ) : null}
                  {c.tasks ? (
                    <span className="t-meta t-num">{c.tasksDone}/{c.tasks} tasks</span>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <GoalDialog
        open={dialogOpen}
        goal={editing}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
      />
    </Page>
  );
}

function statusRank(status: GoalStatus): number {
  return { active: 0, paused: 1, completed: 2, abandoned: 3 }[status];
}
