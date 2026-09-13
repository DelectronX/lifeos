import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, Play, SkipForward, Target } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, Dot } from '@/components/ui/Badge';
import { ProgressBar, Ring, Stat } from '@/components/ui/Progress';
import { toast } from '@/state/toastStore';
import {
  useActivitiesForRange, useBlocksForDay, useGoals, useLiveProfile, useMilestones, useNow,
  useTasks, useTrackerMap,
} from '@/state/useLiveData';
import { completeBlock, minutesByTracker, skipBlock, startBlock } from '@/services/scheduleService';
import { setTaskStatus } from '@/services/taskService';
import { sectionTasks, summarise } from '@/services/taskQuery';
import { PACE_LABELS, paceTone, progressFromLoaded } from '@/services/goalQuery';
import {
  formatDateKeyLong, formatDuration, formatTime, formatTimeRange, todayKey,
} from '@/lib/date';
import { QuickAddTask } from '@/features/tasks/TaskDialog';
import { TaskRow, type TaskRowActions } from '@/features/tasks/TaskRow';
import { ScheduleTaskModal } from '@/features/tasks/ScheduleTaskModal';
import { TaskDialog } from '@/features/tasks/TaskDialog';
import { SlippedTasksBanner } from '@/features/schedule/AutoRescheduleReview';
import type { Task } from '@/types';

/**
 * Home stays deliberately calm: what is happening now, what is next, how today
 * is going, and how the active goals stand. Every number below is derived from
 * real stored records — there are no placeholder values anywhere on this page.
 */
export function HomePage() {
  const today = todayKey();
  const now = useNow(30_000);
  const profile = useLiveProfile();
  const tasks = useTasks();
  const blocks = useBlocksForDay(today);
  const goals = useGoals(true);
  const milestones = useMilestones();
  const trackerMap = useTrackerMap();
  const todayActivities = useActivitiesForRange(today, today);
  const allActivities = useActivitiesForRange('2000-01-01', today);

  const [editing, setEditing] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scheduling, setScheduling] = useState<Task | null>(null);

  const dueToday = useMemo(
    () => tasks.filter((t) => t.dueDate === today || (t.dueDate && t.dueDate < today && t.status !== 'completed' && t.status !== 'cancelled')),
    [tasks, today],
  );
  const todayStats = useMemo(() => summarise(dueToday, today), [dueToday, today]);
  const sections = useMemo(() => sectionTasks(tasks, today), [tasks, today]);

  const activeBlocks = blocks.filter((b) => b.status !== 'cancelled');
  const currentBlock = activeBlocks.find((b) => b.start <= now && b.end > now && b.status !== 'skipped' && b.status !== 'completed');
  const nextBlock = activeBlocks
    .filter((b) => b.start > now && (b.status === 'planned' || b.status === 'in_progress'))
    .sort((a, b) => a.start - b.start)[0];
  const nextTask = sections.overdue[0] ?? sections.today[0] ?? sections.upcoming[0];

  // Today's completion: tasks due today plus scheduled blocks, weighted equally
  // by count so a light day is not misrepresented as a huge percentage.
  const doneUnits = todayStats.completed + activeBlocks.filter((b) => b.status === 'completed').length;
  const totalUnits = dueToday.length + activeBlocks.length;
  const dayProgress = totalUnits > 0 ? doneUnits / totalUnits : 0;

  const trackerMinutes = useMemo(() => {
    // Real tracked time today comes from the Activity log, not from the plan.
    const fromActivity: Record<string, number> = {};
    for (const a of todayActivities) {
      if (!a.trackerId || a.durationMs <= 0) continue;
      fromActivity[a.trackerId] = (fromActivity[a.trackerId] ?? 0) + a.durationMs / 60_000;
    }
    const planned = minutesByTracker(activeBlocks.filter((b) => b.status === 'planned' || b.status === 'in_progress'));
    const ids = new Set([...Object.keys(fromActivity), ...Object.keys(planned)]);
    return [...ids]
      .map((id) => ({ tracker: trackerMap[id], tracked: fromActivity[id] ?? 0, planned: planned[id] ?? 0 }))
      .filter((r) => r.tracker)
      .sort((a, b) => b.tracked + b.planned - (a.tracked + a.planned));
  }, [todayActivities, activeBlocks, trackerMap]);

  const totalTracked = trackerMinutes.reduce((s, r) => s + r.tracked, 0);
  const totalPlanned = trackerMinutes.reduce((s, r) => s + r.planned, 0);

  const goalRows = useMemo(
    () => goals
      .map((goal) => ({ goal, result: progressFromLoaded(goal, tasks, milestones, allActivities, today) }))
      .sort((a, b) => b.goal.weight - a.goal.weight)
      .slice(0, 5),
    [goals, tasks, milestones, allActivities, today],
  );

  const actions = useMemo<TaskRowActions>(() => ({
    onOpen: (task) => { setEditing(task); setDialogOpen(true); },
    onSetStatus: async (task, status) => {
      await setTaskStatus(task.id, status, { reason: 'Changed from Home' });
      if (status === 'completed') toast.success('Completed', task.title);
    },
    onDelete: (task) => { setEditing(task); setDialogOpen(true); },
    onDuplicate: async () => {},
    onSchedule: (task) => setScheduling(task),
  }), []);

  const greeting = greetingFor(new Date(now).getHours(), profile?.displayName);

  return (
    <Page title={greeting} subtitle={formatDateKeyLong(today)}>
      <SlippedTasksBanner className="mb-6" />

      {/* Now / Next */}
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card>
          {currentBlock ? (
            <>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-critical" />
                <span className="t-label">Happening now</span>
              </div>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="t-title truncate">{currentBlock.title}</div>
                  <div className="t-meta t-num mt-1">
                    {formatTimeRange(currentBlock.start, currentBlock.end)} ·{' '}
                    {formatDuration(Math.max(0, (currentBlock.end - now) / 60_000))} left
                  </div>
                </div>
                <div className="flex gap-2">
                  {currentBlock.status === 'planned' ? (
                    <Button
                      size="sm"
                      iconLeft={<Play className="h-3.5 w-3.5" />}
                      onClick={async () => { await startBlock(currentBlock.id); toast.success('Started'); }}
                    >
                      Start
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="primary"
                    iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />}
                    onClick={async () => { await completeBlock(currentBlock.id); toast.success('Completed'); }}
                  >
                    Complete
                  </Button>
                  <Button
                    size="sm"
                    iconLeft={<SkipForward className="h-3.5 w-3.5" />}
                    onClick={async () => { await skipBlock(currentBlock.id); toast.success('Skipped'); }}
                  >
                    Skip
                  </Button>
                </div>
              </div>
            </>
          ) : nextBlock ? (
            <>
              <span className="t-label">Next up</span>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="t-title truncate">{nextBlock.title}</div>
                  <div className="t-meta t-num mt-1">
                    Starts {formatTime(nextBlock.start)} · in {formatDuration(Math.max(0, (nextBlock.start - now) / 60_000))}
                  </div>
                </div>
                <Button size="sm" onClick={async () => { await startBlock(nextBlock.id); toast.success('Started early'); }}>
                  Start early
                </Button>
              </div>
            </>
          ) : nextTask ? (
            <>
              <span className="t-label">Next up</span>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="t-title truncate">{nextTask.title}</div>
                  <div className="t-meta mt-1">
                    Not scheduled yet · {formatDuration(nextTask.estimatedMinutes)} estimated
                  </div>
                </div>
                <Button size="sm" variant="primary" onClick={() => setScheduling(nextTask)}>Schedule it</Button>
              </div>
            </>
          ) : (
            <>
              <span className="t-label">Next up</span>
              <p className="t-muted mt-2">
                Nothing scheduled and nothing due. Add a task below, or open the schedule to plan the day.
              </p>
              <Button size="sm" className="mt-3" iconLeft={<CalendarDays className="h-3.5 w-3.5" />}>
                <Link to="/schedule">Open schedule</Link>
              </Button>
            </>
          )}
        </Card>

        <Card className="flex items-center gap-4">
          <Ring value={dayProgress} size={72} stroke={7} color={dayProgress >= 1 ? 'positive' : 'accent'}>
            <span className="t-num text-sm font-semibold text-ink">{Math.round(dayProgress * 100)}%</span>
          </Ring>
          <div className="min-w-0">
            <div className="t-label">Today</div>
            <div className="t-num mt-1 text-sm text-ink">
              {doneUnits} of {totalUnits} done
            </div>
            <div className="t-meta mt-0.5">
              {todayStats.overdue > 0 ? `${todayStats.overdue} overdue` : 'Nothing overdue'}
            </div>
          </div>
        </Card>
      </div>

      {/* Stats strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card padded={false} className="px-4 py-3">
          <Stat label="Tracked today" value={formatDuration(totalTracked)} sub={`${formatDuration(totalPlanned)} still planned`} />
        </Card>
        <Card padded={false} className="px-4 py-3">
          <Stat label="Open tasks" value={sections.overdue.length + sections.today.length + sections.upcoming.length + sections.undated.length} />
        </Card>
        <Card padded={false} className="px-4 py-3">
          <Stat label="Streak" value={profile?.currentStreak ?? 0} sub={`Best ${profile?.longestStreak ?? 0}`} />
        </Card>
        <Card padded={false} className="px-4 py-3">
          <Stat label="Level" value={profile?.level ?? 1} sub={`${profile?.totalXP ?? 0} XP`} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Today's schedule */}
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="t-title">Today&apos;s schedule</h2>
            <Link to="/schedule" className="t-meta inline-flex items-center gap-1 hover:text-ink">
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {activeBlocks.length === 0 ? (
            <EmptyState title="Nothing scheduled today" description="Open the schedule to block out your day." />
          ) : (
            <Card padded={false} className="overflow-hidden">
              {activeBlocks
                .slice()
                .sort((a, b) => a.start - b.start)
                .map((b) => {
                  const tracker = trackerMap[b.trackerId];
                  const closed = b.status === 'completed' || b.status === 'skipped';
                  return (
                    <div
                      key={b.id}
                      className={`flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 ${closed ? 'opacity-55' : ''}`}
                    >
                      <span className="t-num w-24 shrink-0 text-xs text-ink-muted">{formatTimeRange(b.start, b.end)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{b.title}</span>
                      {tracker ? <Dot color={tracker.color} /> : null}
                      {b.status === 'completed' ? <Badge tone="positive">Done</Badge> : null}
                      {b.status === 'skipped' ? <Badge tone="caution">Skipped</Badge> : null}
                    </div>
                  );
                })}
            </Card>
          )}
        </section>

        {/* Tracker time */}
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="t-title">Time by tracker</h2>
            <span className="t-meta">tracked · planned</span>
          </div>
          {trackerMinutes.length === 0 ? (
            <EmptyState title="No time recorded yet today" description="Complete a block or run a timer to start tracking." />
          ) : (
            <Card className="space-y-3">
              {trackerMinutes.map(({ tracker, tracked, planned }) => {
                const total = tracked + planned;
                const max = Math.max(...trackerMinutes.map((r) => r.tracked + r.planned), 1);
                return (
                  <div key={tracker!.id}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-ink">
                        <Dot color={tracker!.color} />{tracker!.name}
                      </span>
                      <span className="t-num text-2xs text-ink-muted">
                        {formatDuration(tracked)}
                        {planned > 0 ? ` · ${formatDuration(planned)}` : ''}
                      </span>
                    </div>
                    <ProgressBar value={total / max} color={tracker!.color} size="sm" />
                  </div>
                );
              })}
            </Card>
          )}
        </section>
      </div>

      {/* Active goals */}
      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="t-title">Active goals</h2>
          <Link to="/goals" className="t-meta inline-flex items-center gap-1 hover:text-ink">
            All goals <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {goalRows.length === 0 ? (
          <EmptyState
            icon={<Target className="h-7 w-7" />}
            title="No active goals"
            description="Goals give your tasks direction and boost their priority."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {goalRows.map(({ goal, result }) => (
              <Card key={goal.id}>
                <Link to={`/goals/${goal.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-ink hover:underline underline-offset-4">
                      {goal.title}
                    </span>
                    <Badge tone={paceTone(result.paceStatus)}>{PACE_LABELS[result.paceStatus]}</Badge>
                  </div>
                  <ProgressBar
                    className="mt-3"
                    value={result.progress}
                    color={goal.color ?? trackerMap[goal.trackerId]?.color ?? 'indigo'}
                    size="sm"
                  />
                  <div className="t-meta mt-1.5 t-num">
                    {result.current} / {result.target} {result.unitLabel}
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Focus list */}
      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="t-title">Needs attention</h2>
          <Link to="/tasks" className="t-meta inline-flex items-center gap-1 hover:text-ink">
            All tasks <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="mb-3">
          <QuickAddTask onAdded={() => toast.success('Task added')} />
        </div>
        {[...sections.overdue, ...sections.today].length === 0 ? (
          <EmptyState title="Nothing overdue or due today" description="A clear day. Plan ahead or take the win." />
        ) : (
          <Card padded={false} className="overflow-hidden">
            {[...sections.overdue, ...sections.today].slice(0, 8).map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                tracker={trackerMap[task.trackerId]}
                actions={actions}
                compact
              />
            ))}
          </Card>
        )}
      </section>

      <TaskDialog open={dialogOpen} task={editing} onClose={() => { setDialogOpen(false); setEditing(null); }} />
      <ScheduleTaskModal open={!!scheduling} task={scheduling} onClose={() => setScheduling(null)} />
    </Page>
  );
}

function greetingFor(hour: number, name?: string): string {
  const part = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Good night';
  return name ? `${part}, ${name}` : part;
}
