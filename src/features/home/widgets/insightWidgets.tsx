import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity as ActivityIcon, AlarmClockOff, BarChart3, CalendarClock, CalendarDays, Check, CheckCircle2, Flame, FolderKanban,
  Gauge, PieChart, Target, Timer, Trophy,
} from 'lucide-react';
import { db } from '@/db/db';
import { cn } from '@/lib/cn';
import {
  addDaysToKey, formatDuration, formatTime, relativeDayLabel, todayKey,
} from '@/lib/date';
import {
  useActivitiesForRange, useBlocksForDay, useBlocksForRange, useGoals, useLiveProfile, useMilestones, useNow,
  useSessionsForRange, useTasks, useTrackerMap,
} from '@/state/useLiveData';
import { isRequiredBlock } from '@/engines/customMetrics';
import { workProgress, projectHealth } from '@/engines/workgrowth';
import { progressFromLoaded } from '@/services/goalQuery';
import { sectionTasks } from '@/services/taskQuery';
import { setTaskStatus } from '@/services/taskService';
import { toast } from '@/state/toastStore';
import { trackerHex } from '@/features/schedule/dayRibbon';
import { LifecycleStepper } from '@/components/charts/SegmentedProgress';
import { relativeTime } from '@/components/system/relativeTime';
import { useTodayProgress } from '../useTodayProgress';
import { WidgetEmpty, WidgetMetric, WidgetShell, WidgetSkeleton } from './WidgetShell';
import type { WidgetComponentProps } from './types';
import type { Activity, ActivityType } from '@/types';

/* ------------------------------------------------------------------ */
/* 1. Daily Productivity                                               */
/* ------------------------------------------------------------------ */

export function DailyProductivityWidget(_: WidgetComponentProps) {
  const p = useTodayProgress();
  const pct = p.overall === null ? null : Math.round(p.overall * 100);
  const rows = [
    { label: 'Blocks', ...p.blocks, color: 'rgb(var(--c-accent))' },
    { label: 'Tasks', ...p.tasks, color: 'rgb(var(--c-positive))' },
    { label: 'Checklists', ...p.checklists, color: 'rgb(var(--c-caution))' },
  ];
  return (
    <WidgetShell title="Daily productivity" icon={Gauge} tone="accent" href="/schedule">
      <div className="flex items-center gap-4">
        <Donut value={p.overall ?? 0} size={76} label={pct === null ? '—' : `${pct}%`} />
        <div className="min-w-0 flex-1 space-y-2">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-baseline justify-between text-[0.75rem]">
                <span className="text-ink-muted">{r.label}</span>
                <span className="t-num font-medium text-ink">{r.total ? `${r.done}/${r.total}` : '—'}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink/10">
                <div className="h-full rounded-full transition-[width] duration-700 ease-calm" style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%`, backgroundColor: r.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </WidgetShell>
  );
}

function Donut({ value, size, label }: { value: number; size: number; label: string }) {
  const s = 8, r = (size - s) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-ink) / 0.1)" strokeWidth={s} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={s} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} style={{ transition: 'stroke-dashoffset 900ms var(--ease-out)' }} />
      </svg>
      <span className="t-num t-rounded absolute inset-0 grid place-items-center text-[1.0625rem] font-semibold text-ink">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Time Distribution                                                */
/* ------------------------------------------------------------------ */

export function TimeDistributionWidget(_: WidgetComponentProps) {
  const [range, setRange] = useState<'today' | 'week'>('week');
  const today = todayKey();
  const from = range === 'today' ? today : addDaysToKey(today, -6);
  const activities = useActivitiesForRange(from, today);
  const trackers = useTrackerMap();
  const slices = useMemo(() => {
    const by = new Map<string, number>();
    for (const a of activities) {
      if (a.durationMs <= 0 || !a.trackerId) continue;
      // Roll sub-trackers up to their top-level area so the split stays readable.
      let id = a.trackerId; const seen = new Set<string>();
      while (trackers[id]?.parentId && !seen.has(id)) { seen.add(id); id = trackers[id].parentId as string; }
      by.set(id, (by.get(id) ?? 0) + a.durationMs / 60_000);
    }
    const sorted = [...by.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((s, [, m]) => s + m, 0);
    const out = top.map(([id, m]) => ({ id, name: trackers[id]?.name ?? 'Other', minutes: m, color: trackerHex(trackers[id]?.color) }));
    if (rest > 0) out.push({ id: 'other', name: 'Other', minutes: rest, color: 'rgb(var(--c-ink) / 0.3)' });
    return out;
  }, [activities, trackers]);
  const total = slices.reduce((s, x) => s + x.minutes, 0);

  return (
    <WidgetShell title="Time distribution" icon={PieChart} tone="teal" href="/analytics"
      trailing={<RangeToggle value={range} onChange={setRange} />}>
      {total === 0 ? <WidgetEmpty text={range === 'today' ? 'No tracked time yet today.' : 'No tracked time in the last 7 days.'} /> : (
        <>
          <WidgetMetric value={formatDuration(total)} caption={range === 'today' ? 'tracked today' : 'tracked in the last 7 days'} />
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-ink/10" role="img" aria-label="Time by area">
            {slices.map((s) => <div key={s.id} className="h-full transition-[width] duration-700 ease-calm first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.minutes / total) * 100}%`, backgroundColor: s.color }} title={`${s.name} ${formatDuration(s.minutes)}`} />)}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {slices.map((s) => (
              <li key={s.id} className="flex min-w-0 items-center gap-1.5 text-[0.75rem]">
                <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
                <span className="min-w-0 flex-1 truncate text-ink-muted">{s.name}</span>
                <span className="t-num text-ink">{Math.round((s.minutes / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetShell>
  );
}

function RangeToggle<T extends string>({ value, onChange }: { value: T; onChange: (v: T) => void }) {
  const opts = ['today', 'week'] as unknown as T[];
  return (
    <div className="flex rounded-[7px] bg-ink/[0.06] p-0.5" role="radiogroup" aria-label="Range">
      {opts.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)}
          className={cn('h-5 rounded-[5px] px-1.5 text-[0.6875rem] font-medium capitalize transition-colors', value === o ? 'bg-surface-overlay text-ink shadow-sm' : 'text-ink-faint hover:text-ink-muted')}>
          {o === 'week' ? '7d' : 'Today'}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Schedule Overview                                                */
/* ------------------------------------------------------------------ */

export function ScheduleOverviewWidget(_: WidgetComponentProps) {
  const today = todayKey();
  const now = useNow(30_000);
  const blocks = useBlocksForDay(today);
  const trackers = useTrackerMap();
  const list = blocks.filter((b) => b.status !== 'cancelled' && b.kind !== 'sleep').sort((a, b) => a.start - b.start);
  const currentIdx = list.findIndex((b) => b.start <= now && b.end > now);
  const firstUpcoming = list.findIndex((b) => b.start > now);
  const anchor = currentIdx >= 0 ? currentIdx : firstUpcoming >= 0 ? firstUpcoming : Math.max(0, list.length - 4);
  const shown = list.slice(Math.max(0, anchor - 1), Math.max(0, anchor - 1) + 6);
  const done = list.filter((b) => b.status === 'completed').length;

  return (
    <WidgetShell title="Schedule" icon={CalendarDays} tone="accent" href="/schedule"
      trailing={<span className="t-num text-[0.75rem] text-ink-faint">{done}/{list.length} done</span>}>
      {list.length === 0 ? <WidgetEmpty icon={CalendarDays} text="Nothing scheduled today." /> : (
        <ol className="relative space-y-0.5">
          {shown.map((b) => {
            const isNow = b.start <= now && b.end > now && b.status !== 'completed';
            const past = b.end <= now;
            const color = trackerHex(trackers[b.trackerId]?.color);
            const state = b.status === 'completed' ? 'done' : b.status === 'skipped' ? 'skipped' : isNow ? 'now' : past ? 'missed' : 'next';
            return (
              <li key={b.id} className={cn('relative flex items-center gap-2.5 rounded-[9px] px-2 py-1.5', isNow && 'bg-ink/[0.05]')}>
                <span className="t-num w-14 shrink-0 text-[0.6875rem] text-ink-faint">{formatTime(b.start)}</span>
                <span className="relative grid h-4 w-4 shrink-0 place-items-center">
                  {state === 'done' ? <CheckCircle2 className="h-4 w-4 text-positive" />
                    : state === 'now' ? <span className="live-dot h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                    : <span className={cn('h-2 w-2 rounded-full', state === 'missed' ? 'bg-caution/70' : state === 'skipped' ? 'bg-ink/20' : 'ring-[1.5px]')} style={state === 'next' ? { ['--tw-ring-color' as string]: color } : undefined} />}
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-[0.8125rem]', state === 'done' || state === 'skipped' ? 'text-ink-faint' : 'text-ink', isNow && 'font-semibold', state === 'skipped' && 'line-through')}>{b.title}</span>
                {isNow ? <span className="t-num shrink-0 text-[0.6875rem] font-semibold" style={{ color }}>{formatDuration(Math.max(0, (b.end - now) / 60_000))} left</span>
                  : state === 'missed' ? <span className="shrink-0 text-[0.6875rem] text-caution">Not logged</span> : null}
              </li>
            );
          })}
        </ol>
      )}
    </WidgetShell>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Weekly Performance                                               */
/* ------------------------------------------------------------------ */

export function WeeklyPerformanceWidget(_: WidgetComponentProps) {
  const today = todayKey();
  const from = addDaysToKey(today, -13);
  const blocks = useBlocksForRange(from, today);
  const data = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDaysToKey(from, i));
    return days.map((d) => {
      const req = blocks.filter((b) => b.date === d && isRequiredBlock(b));
      const done = req.filter((b) => b.status === 'completed').length;
      return { date: d, rate: req.length ? done / req.length : null, done, total: req.length };
    });
  }, [blocks, from]);
  const avg = (xs: typeof data) => { const v = xs.filter((x) => x.rate !== null); return v.length ? v.reduce((s, x) => s + (x.rate ?? 0), 0) / v.length : null; };
  const thisWeek = data.slice(7), lastWeek = data.slice(0, 7);
  const a = avg(thisWeek), b = avg(lastWeek);
  const delta = a !== null && b !== null ? Math.round((a - b) * 100) : null;

  return (
    <WidgetShell title="Weekly performance" icon={BarChart3} tone="violet" href="/analytics">
      {a === null ? <WidgetEmpty text="No required blocks in the last 7 days." /> : (
        <>
          <div className="flex items-end justify-between gap-3">
            <WidgetMetric value={Math.round(a * 100)} unit="%" caption="required blocks completed, last 7 days" />
            {delta !== null ? (
              <span className={cn('t-num rounded-full px-2 py-0.5 text-[0.75rem] font-semibold', delta >= 0 ? 'bg-positive/15 text-positive' : 'bg-critical/15 text-critical')}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} pts
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex h-16 items-end gap-1" role="img" aria-label="Completion rate per day, last 7 days">
            {thisWeek.map((d) => (
              <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${relativeDayLabel(d.date, today)}: ${d.total ? `${d.done}/${d.total}` : 'nothing required'}`}>
                <div className="w-full max-w-[18px] rounded-t-[4px] transition-[height] duration-700 ease-calm"
                  style={{ height: `${Math.max(4, (d.rate ?? 0) * 100)}%`, backgroundColor: d.rate === null ? 'rgb(var(--c-ink) / 0.08)' : d.date === today ? 'rgb(var(--c-accent))' : 'rgb(var(--c-accent) / 0.45)' }} />
                <span className={cn('text-[0.625rem]', d.date === today ? 'font-semibold text-ink' : 'text-ink-faint')}>
                  {new Date(`${d.date}T00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </WidgetShell>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Goal Progress                                                    */
/* ------------------------------------------------------------------ */

export function GoalProgressWidget(_: WidgetComponentProps) {
  const goals = useGoals(true);
  const milestones = useMilestones();
  const tasks = useTasks();
  const activities = useActivitiesForRange('2000-01-01', todayKey());
  const trackers = useTrackerMap();
  const rows = useMemo(() => goals
    .map((g) => ({ g, r: progressFromLoaded(g, tasks, milestones, activities), ms: milestones.filter((m) => m.goalId === g.id).sort((a, b) => a.sortOrder - b.sortOrder) }))
    .sort((a, b) => b.r.progress - a.r.progress)
    .slice(0, 4), [goals, tasks, milestones, activities]);

  return (
    <WidgetShell title="Goal progress" icon={Target} tone="positive" href="/goals">
      {rows.length === 0 ? <WidgetEmpty icon={Target} text="No active goals yet." /> : (
        <ul className="space-y-3">
          {rows.map(({ g, r, ms }) => {
            const color = trackerHex(g.color ?? trackers[g.trackerId]?.color);
            const pct = Math.round(r.progress * 100);
            return (
              <li key={g.id}>
                <Link to={`/goals/${g.id}`} className="group block rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                  <div className="flex items-baseline gap-2 text-[0.8125rem]">
                    <span className="min-w-0 flex-1 truncate text-ink group-hover:underline">{g.title}</span>
                    <span className="t-num shrink-0 font-semibold text-ink">{pct}%</span>
                  </div>
                  <div className="relative mt-1.5 h-[10px]">
                    <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-ink/10" />
                    <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-[width] duration-700 ease-calm" style={{ width: `${pct}%`, backgroundColor: color }} />
                    {ms.map((m, i) => (
                      <span key={m.id} title={m.title} className="absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1.5px]"
                        style={{ left: `${((i + 1) / (ms.length + 1)) * 100}%`, backgroundColor: m.completedAt ? color : 'rgb(var(--c-surface-raised))', boxShadow: m.completedAt ? 'none' : 'inset 0 0 0 1px rgb(var(--c-ink) / 0.3)' }} />
                    ))}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetShell>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Project Overview                                                 */
/* ------------------------------------------------------------------ */

const HEALTH_LABEL: Record<string, { text: string; cls: string }> = {
  on_track: { text: 'On track', cls: 'text-positive' }, at_risk: { text: 'At risk', cls: 'text-caution' },
  off_track: { text: 'Behind', cls: 'text-critical' },
  idle: { text: 'Not started', cls: 'text-ink-faint' }, done: { text: 'Shipped', cls: 'text-positive' },
};

export function ProjectOverviewWidget(_: WidgetComponentProps) {
  const today = todayKey();
  const data = useLiveQuery(async () => {
    const [projects, milestones, tasks] = await Promise.all([db.projects.toArray(), db.milestones.toArray(), db.tasks.toArray()]);
    return projects
      .filter((p) => p.status !== 'archived')
      .map((p) => { const wp = workProgress(milestones.filter((m) => m.goalId === p.goalId), tasks.filter((t) => t.goalId === p.goalId), today); return { p, wp, health: projectHealth(p, wp, today) }; })
      .sort((a, b) => Number(b.p.status === 'active') - Number(a.p.status === 'active') || b.wp.progress - a.wp.progress);
  }, [today]);

  return (
    <WidgetShell title="Projects" icon={FolderKanban} tone="caution" href="/projects">
      {data === undefined ? <WidgetSkeleton lines={3} /> : data.length === 0 ? <WidgetEmpty icon={FolderKanban} text="No projects yet." /> : (
        <ul className="divide-y divide-line-faint">
          {data.slice(0, 4).map(({ p, wp, health }) => {
            const h = HEALTH_LABEL[health] ?? HEALTH_LABEL.idle;
            return (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="group flex items-center gap-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.8125rem] text-ink group-hover:underline">{p.title}</div>
                    <div className="mt-1 flex items-center gap-2"><LifecycleStepper status={p.status} /><span className={cn('text-[0.6875rem]', h.cls)}>{h.text}</span></div>
                  </div>
                  <span className="t-num text-[0.8125rem] font-semibold text-ink">{Math.round(wp.progress * 100)}%</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetShell>
  );
}

/* ------------------------------------------------------------------ */
/* 7. Streak Tracker                                                   */
/* ------------------------------------------------------------------ */

export function StreakTrackerWidget(_: WidgetComponentProps) {
  const profile = useLiveProfile();
  const today = todayKey();
  const from = addDaysToKey(today, -27);
  const activities = useActivitiesForRange(from, today);
  const active = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of activities) m.set(a.date, (m.get(a.date) ?? 0) + 1);
    return m;
  }, [activities]);
  const days = Array.from({ length: 28 }, (_, i) => addDaysToKey(from, i));
  const streak = profile?.currentStreak ?? 0;
  const max = Math.max(1, ...active.values());

  return (
    <WidgetShell title="Streak" icon={Flame} tone="caution" href="/achievements">
      <div className="flex items-end justify-between gap-3">
        <WidgetMetric value={streak} unit={streak === 1 ? 'day' : 'days'} caption={`Best ${profile?.longestStreak ?? 0} · ${active.size} of 28 days active`} />
        {streak > 0 ? <Flame className="h-7 w-7 text-caution" strokeWidth={1.8} aria-hidden /> : null}
      </div>
      <div className="mt-3 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1" role="img" aria-label="Activity in the last 28 days">
        {days.map((d) => {
          const n = active.get(d) ?? 0;
          return <span key={d} title={`${d}: ${n} activit${n === 1 ? 'y' : 'ies'}`}
            className={cn('aspect-square rounded-[3px]', d === today && 'ring-1 ring-ink/40')}
            style={{ backgroundColor: n ? `rgb(var(--c-caution) / ${0.3 + 0.7 * (n / max)})` : 'rgb(var(--c-ink) / 0.07)' }} />;
        })}
      </div>
    </WidgetShell>
  );
}

/* ------------------------------------------------------------------ */
/* 8. Upcoming Deadlines                                               */
/* ------------------------------------------------------------------ */

export function UpcomingDeadlinesWidget(_: WidgetComponentProps) {
  const today = todayKey();
  const tasks = useTasks();
  const upcoming = tasks
    .filter((t) => t.dueDate && t.dueDate >= today && t.status !== 'completed' && t.status !== 'cancelled')
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || b.basePriority - a.basePriority)
    .slice(0, 6);
  return (
    <WidgetShell title="Upcoming deadlines" icon={CalendarClock} tone="accent" href="/tasks">
      {upcoming.length === 0 ? <WidgetEmpty icon={CalendarClock} text="No upcoming deadlines." /> : (
        <ul className="space-y-1">
          {upcoming.map((t) => {
            const days = Math.round((new Date(`${t.dueDate}T00:00`).getTime() - new Date(`${today}T00:00`).getTime()) / 86_400_000);
            return (
              <li key={t.id} className="flex items-center gap-2.5 py-1">
                <span className={cn('t-num grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[0.75rem] font-semibold leading-none',
                  days <= 1 ? 'bg-critical/15 text-critical' : days <= 3 ? 'bg-caution/15 text-caution' : 'bg-ink/[0.06] text-ink-muted')}>
                  {days === 0 ? 'Now' : `${days}d`}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.8125rem] text-ink">{t.title}</div>
                  <div className="text-[0.6875rem] text-ink-faint">{relativeDayLabel(t.dueDate!, today)}{t.deadlineHard ? ' · hard deadline' : ''}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetShell>
  );
}

/* ------------------------------------------------------------------ */
/* 9. Achievement Showcase                                             */
/* ------------------------------------------------------------------ */

export function AchievementShowcaseWidget(_: WidgetComponentProps) {
  const data = useLiveQuery(async () => {
    const all = await db.achievements.toArray();
    const unlocked = all.filter((a) => a.unlockedAt).sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0));
    const nearest = all.filter((a) => !a.unlockedAt && a.target > 0).sort((a, b) => b.progress / b.target - a.progress / a.target)[0];
    return { unlocked, total: all.length, nearest };
  }, []);
  return (
    <WidgetShell title="Achievements" icon={Trophy} tone="caution" href="/achievements">
      {data === undefined ? <WidgetSkeleton lines={3} /> : (
        <>
          <WidgetMetric value={data.unlocked.length} unit={`/ ${data.total}`} caption="unlocked" />
          {data.unlocked.length ? (
            <ul className="mt-3 space-y-1.5">
              {data.unlocked.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-center gap-2.5">
                  <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full',
                    a.tier === 3 ? 'bg-[rgb(255_214_10/0.2)] text-[rgb(170_120_0)] dark:text-[rgb(255_214_10)]' : a.tier === 2 ? 'bg-ink/10 text-ink' : 'bg-caution/15 text-caution')}>
                    <Trophy className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">{a.title}</span>
                  <span className="shrink-0 text-[0.6875rem] text-ink-faint">{relativeTime(a.unlockedAt as number)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {data.nearest ? (
            <div className="mt-3 rounded-[9px] bg-ink/[0.04] px-2.5 py-2">
              <div className="flex items-baseline justify-between gap-2 text-[0.75rem]">
                <span className="min-w-0 truncate text-ink-muted">Next · {data.nearest.title}</span>
                <span className="t-num shrink-0 text-ink">{Math.min(data.nearest.progress, data.nearest.target)}/{data.nearest.target}</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-caution" style={{ width: `${Math.min(100, (data.nearest.progress / data.nearest.target) * 100)}%` }} /></div>
            </div>
          ) : null}
        </>
      )}
    </WidgetShell>
  );
}

/* ------------------------------------------------------------------ */
/* 10. Focus Statistics                                                */
/* ------------------------------------------------------------------ */

export function FocusStatsWidget(_: WidgetComponentProps) {
  const today = todayKey();
  const sessions = useSessionsForRange(addDaysToKey(today, -6), today);
  const todays = sessions.filter((s) => s.date === today);
  const mins = (xs: typeof sessions) => xs.reduce((s, x) => s + x.workMs, 0) / 60_000;
  const week = mins(sessions);
  const done = sessions.filter((s) => s.completed).length;
  const avg = sessions.length ? week / sessions.length : 0;
  return (
    <WidgetShell title="Focus" icon={Timer} tone="violet" href="/focus">
      {sessions.length === 0 ? <WidgetEmpty icon={Timer} text="No focus sessions in the last 7 days." action={<Link to="/focus" className="text-[0.75rem] font-semibold text-accent-ink hover:underline">Start one</Link>} /> : (
        <>
          <WidgetMetric value={formatDuration(mins(todays))} caption={`today · ${todays.length} session${todays.length === 1 ? '' : 's'}`} />
          <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line-faint pt-3">
            {[['7 days', formatDuration(week)], ['Completed', `${done}/${sessions.length}`], ['Avg', formatDuration(avg)]].map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-[0.6875rem] text-ink-faint">{k}</dt><dd className="t-num truncate text-[0.875rem] font-semibold text-ink">{v}</dd></div>
            ))}
          </dl>
        </>
      )}
    </WidgetShell>
  );
}

/* ------------------------------------------------------------------ */
/* 11. Overdue Tasks                                                   */
/* ------------------------------------------------------------------ */

export function OverdueTasksWidget(_: WidgetComponentProps) {
  const today = todayKey();
  const tasks = useTasks();
  const overdue = useMemo(() => sectionTasks(tasks, today).overdue, [tasks, today]);
  const complete = async (id: string, title: string) => {
    try { await setTaskStatus(id, 'completed'); toast.notify({ title: 'Task done', description: title, tone: 'success', category: 'tasks', silent: true }); }
    catch (e) { toast.error('Could not complete task', e instanceof Error ? e.message : String(e)); }
  };
  return (
    <WidgetShell title="Overdue" icon={AlarmClockOff} tone={overdue.length ? 'critical' : 'neutral'} href="/tasks"
      trailing={overdue.length ? <span className="t-num rounded-full bg-critical/15 px-1.5 text-[0.6875rem] font-semibold text-critical">{overdue.length}</span> : undefined}>
      {overdue.length === 0 ? <WidgetEmpty icon={Check} text="Nothing overdue. Nice." /> : (
        <ul className="space-y-0.5">
          {overdue.slice(0, 5).map((t) => (
            <li key={t.id} className="group flex items-center gap-2.5 rounded-[8px] px-1 py-1.5 hover:bg-ink/[0.04]">
              <button type="button" aria-label={`Complete ${t.title}`} onClick={() => void complete(t.id, t.title)}
                className="touch-hit grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ring-[1.5px] ring-ink/30 transition-colors hover:bg-positive/20 hover:ring-positive focus-visible:outline-none focus-visible:ring-accent">
                <Check className="h-3 w-3 text-positive opacity-0 group-hover:opacity-100" strokeWidth={3} />
              </button>
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">{t.title}</span>
              <span className="t-num shrink-0 text-[0.6875rem] font-medium text-critical">{relativeDayLabel(t.dueDate!, today)}</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

/* ------------------------------------------------------------------ */
/* 12. Activity Timeline                                               */
/* ------------------------------------------------------------------ */

const ACT_ICON: Partial<Record<ActivityType, typeof Check>> = {
  task_completed: CheckCircle2, block_completed: CalendarDays, timer_session: Timer, achievement_unlocked: Trophy, level_up: Trophy,
  goal_completed: Target, milestone_completed: Target, project_shipped: FolderKanban, checklist_completed: Check,
};

export function ActivityTimelineWidget(_: WidgetComponentProps) {
  const recent = useLiveQuery(() => db.activities.orderBy('at').reverse().limit(8).toArray(), []);
  return (
    <WidgetShell title="Recent activity" icon={ActivityIcon} tone="neutral" href="/analytics">
      {recent === undefined ? <WidgetSkeleton lines={4} /> : recent.length === 0 ? <WidgetEmpty icon={ActivityIcon} text="Things you complete show up here." /> : (
        <ol className="relative ml-1.5 border-l border-line-faint">
          {recent.map((a: Activity) => {
            const Icon = ACT_ICON[a.type] ?? ActivityIcon;
            return (
              <li key={a.id} className="relative flex items-start gap-2.5 pb-2 pl-4 last:pb-0">
                <span className="absolute -left-[9px] top-0.5 grid h-[17px] w-[17px] place-items-center rounded-full bg-surface-raised ring-1 ring-line"><Icon className="h-2.5 w-2.5 text-ink-muted" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.8125rem] text-ink">{a.title || a.type.replace(/_/g, ' ')}</div>
                  <div className="text-[0.6875rem] text-ink-faint">{a.type.replace(/_/g, ' ')}{a.durationMs > 0 ? ` · ${formatDuration(a.durationMs / 60_000)}` : ''}</div>
                </div>
                <span className="shrink-0 text-[0.6875rem] text-ink-faint">{relativeTime(a.at)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </WidgetShell>
  );
}
