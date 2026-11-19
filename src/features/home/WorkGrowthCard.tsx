import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { addDaysToKey, relativeDayLabel, todayKey } from '@/lib/date';
import { InsetGroup, Meter } from '@/components/ui/Grouped';
import { checklistProgress, dueDateFor, periodKeyFor, workProgress } from '@/engines/workgrowth';

/**
 * Home summary of the Work & Growth layer: what is due across checklists,
 * projects, clients and exams. Read-only — every row links to its module.
 * Renders nothing until at least one of those modules has data.
 */
export function WorkGrowthCard() {
  const today = todayKey();
  const data = useLiveQuery(async () => {
    const [lists, runs, projects, milestones, tasks, contacts, tracks] = await Promise.all([
      db.checklists.filter((l) => l.active).toArray(),
      db.checklistRuns.toArray(),
      db.projects.filter((p) => p.status === 'active' || p.status === 'testing' || p.status === 'planning').toArray(),
      db.milestones.toArray(),
      db.tasks.toArray(),
      db.contacts.filter((c) => !!c.nextFollowUp && c.stage !== 'lost').toArray(),
      db.examTracks.filter((t) => !!t.examDate).toArray(),
    ]);
    return { lists, runs, projects, milestones, tasks, contacts, tracks };
  }, []);
  if (!data) return null;

  const rows: Array<{ key: string; to: string; title: string; subtitle?: string; trailing?: string; progress?: number }> = [];

  for (const list of data.lists) {
    const run = data.runs.find((r) => r.checklistId === list.id && r.periodKey === periodKeyFor(list.cadence, today));
    const p = checklistProgress(list, run, today);
    if (p.total === 0 || p.complete) continue;
    const due = dueDateFor(list, today);
    // Weekly / monthly lists surface from 2 days before they are due.
    if (list.cadence !== 'daily' && due > addDaysToKey(today, 2)) continue;
    rows.push({
      key: list.id, to: '/checklists', title: list.title, progress: p.done / p.total,
      subtitle: list.cadence === 'daily' ? 'Today' : `Due ${relativeDayLabel(due, today)}`, trailing: `${p.done}/${p.total}`,
    });
  }

  for (const project of data.projects.slice(0, 3)) {
    const wp = workProgress(data.milestones.filter((m) => m.goalId === project.goalId), data.tasks.filter((t) => t.goalId === project.goalId), today);
    if (!wp.nextTask) continue;
    rows.push({
      key: project.id, to: `/projects/${project.id}`, title: wp.nextTask.title,
      subtitle: `${project.title}${wp.nextMilestone ? ` · ${wp.nextMilestone.title}` : ''}`, progress: wp.progress,
      trailing: `${Math.round(wp.progress * 100)}%`,
    });
  }

  const due = data.contacts.filter((c) => c.nextFollowUp! <= today);
  if (due.length) {
    rows.push({ key: 'followups', to: '/earning', title: `Follow up with ${due.slice(0, 2).map((c) => c.name).join(', ')}${due.length > 2 ? ` +${due.length - 2}` : ''}`, subtitle: 'Clients & leads' });
  }

  for (const t of data.tracks) {
    if (!t.examDate || t.examDate < today || t.examDate > addDaysToKey(today, 60)) continue;
    rows.push({ key: t.id, to: '/exams', title: t.title, subtitle: 'Exam', trailing: relativeDayLabel(t.examDate, today) });
  }

  if (rows.length === 0) return null;
  return (
    <InsetGroup header="Up next">
      {rows.slice(0, 7).map((r) => (
        <Link key={r.key} to={r.to} className="flex min-h-[2.75rem] items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-sunken/60">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.9375rem] text-ink">{r.title}</div>
            {r.subtitle ? <div className="truncate text-[0.8125rem] text-ink-muted">{r.subtitle}</div> : null}
            {r.progress !== undefined ? <Meter className="mt-1.5 max-w-[12rem]" value={r.progress} /> : null}
          </div>
          {r.trailing ? <span className="shrink-0 text-[0.8125rem] tabular text-ink-muted">{r.trailing}</span> : null}
        </Link>
      ))}
    </InsetGroup>
  );
}

