import { LifecycleStepper, SegmentedProgress } from '@/components/charts/SegmentedProgress';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, CalendarPlus, ExternalLink, FolderKanban, GitBranch, Plus, Trash2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { CheckCircle, HealthChip, InsetGroup, Meter, MetricTile, Row } from '@/components/ui/Grouped';
import { db } from '@/db/db';
import { formatDateKeyShort, relativeDayLabel, todayKey } from '@/lib/date';
import { toast } from '@/state/toastStore';
import { projectHealth, workProgress } from '@/engines/workgrowth';
import {
  SOFTWARE_TEMPLATE, addDeliverable, addProjectTask, createProject, toggleDeliverable, updateProject,
} from '@/services/projectService';
import { createMilestone, deleteMilestone, toggleMilestone } from '@/services/goalService';
import { setTaskStatus, updateTask } from '@/services/taskService';
import type { Milestone, Task } from '@/types';
import type { Project, ProjectKind, ProjectStatus } from '@/types/workgrowth';

export const PROJECT_STATUS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'idea', label: 'Idea' },
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Building' },
  { value: 'testing', label: 'Testing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];
const KINDS: Array<{ value: ProjectKind; label: string }> = [
  { value: 'portfolio', label: 'Portfolio' }, { value: 'app', label: 'App' }, { value: 'client', label: 'Client' },
  { value: 'research', label: 'Research' }, { value: 'course', label: 'Course' }, { value: 'personal', label: 'Personal' },
];
const statusLabel = (s: ProjectStatus) => PROJECT_STATUS.find((x) => x.value === s)?.label ?? s;

function useProjectData() {
  const projects = useLiveQuery(() => db.projects.orderBy('sortOrder').toArray(), []) ?? [];
  const milestones = useLiveQuery(() => db.milestones.toArray(), []) ?? [];
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) ?? [];
  return { projects, milestones, tasks };
}

/* ================================================================== */
/* Portfolio overview                                                  */
/* ================================================================== */

export function ProjectsPage() {
  const { projects, milestones, tasks } = useProjectData();
  const [scope, setScope] = useState<'current' | 'shipped' | 'all'>('current');
  const [creating, setCreating] = useState(false);
  const today = todayKey();
  const navigate = useNavigate();

  const rows = useMemo(() => projects.map((p) => {
    const wp = workProgress(milestones.filter((m) => m.goalId === p.goalId), tasks.filter((t) => t.goalId === p.goalId), today);
    return { p, wp, health: projectHealth(p, wp, today) };
  }), [projects, milestones, tasks, today]);

  const shown = rows.filter(({ p }) =>
    scope === 'all' ? true : scope === 'shipped' ? p.status === 'shipped' : !['shipped', 'archived'].includes(p.status));
  const active = rows.filter(({ p }) => p.status === 'active' || p.status === 'testing');
  const shipped = rows.filter(({ p }) => p.status === 'shipped').length;
  const atRisk = rows.filter((r) => r.health === 'at_risk' || r.health === 'off_track').length;
  const openTasks = rows.reduce((s, r) => s + (r.wp.tasksTotal - r.wp.tasksDone), 0);

  return (
    <Page
      title="Projects"
      subtitle="Every project owns a goal: its milestones and tasks flow into Tasks, Auto Plan, XP and achievements."
      actions={<Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New project</Button>}
    >
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="In progress" value={active.length} caption={`${rows.length} total`} />
        <MetricTile label="Shipped" value={shipped} tone={shipped ? 'positive' : 'default'} />
        <MetricTile label="Needs attention" value={atRisk} tone={atRisk ? 'caution' : 'default'} caption="behind their target date" />
        <MetricTile label="Open tasks" value={openTasks} />
      </div>

      <div className="mb-4 max-w-sm">
        <SegmentedControl aria-label="Scope" fullWidth value={scope} onChange={setScope}
          items={[{ value: 'current', label: 'Current' }, { value: 'shipped', label: 'Shipped' }, { value: 'all', label: 'All' }]} />
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<FolderKanban className="h-6 w-6" />} title="No projects here"
          description="Add a portfolio project or app. A milestone template is offered so you can start planning right away."
          action={<Button variant="primary" onClick={() => setCreating(true)}>New project</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map(({ p, wp, health }) => (
            <button key={p.id} type="button" onClick={() => navigate(`/projects/${p.id}`)}
              className="surface-card surface-hover group flex min-h-[10rem] flex-col rounded-[var(--r-lg)] p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[1.0625rem] font-semibold text-ink">{p.title}</div>
                  <div className="mt-1 flex items-center gap-2 text-[0.75rem] text-ink-muted">
                    <LifecycleStepper status={p.status} />
                    <span className="truncate">{KINDS.find((k) => k.value === p.kind)?.label} · {statusLabel(p.status)}</span>
                  </div>
                </div>
                <HealthChip health={health} />
              </div>
              {p.summary ? <p className="mt-2 line-clamp-2 text-[0.8125rem] leading-snug text-ink-muted">{p.summary}</p> : null}
              <div className="mt-auto pt-3">
                <div className="mb-1.5 flex justify-between text-[0.75rem] text-ink-faint tabular">
                  <span>{wp.milestonesTotal ? `${wp.milestonesDone}/${wp.milestonesTotal} milestones` : `${wp.tasksDone}/${wp.tasksTotal} tasks`}</span>
                  <span>{p.targetDate ? relativeDayLabel(p.targetDate, today) : 'No date'}</span>
                </div>
                {(() => {
                  const ms = milestones.filter((m) => m.goalId === p.goalId).sort((a, b) => a.sortOrder - b.sortOrder);
                  const color = health === 'done' ? 'rgb(var(--c-positive))' : 'rgb(var(--c-accent))';
                  if (ms.length < 2) return <Meter value={wp.progress} tone={health === 'done' ? 'positive' : 'accent'} />;
                  return (
                    <SegmentedProgress
                      color={color}
                      segments={ms.map((m) => {
                        const own = tasks.filter((t) => t.milestoneId === m.id && t.status !== 'cancelled');
                        const v = m.completedAt ? 1 : own.length ? own.filter((t) => t.status === 'completed').length / own.length : 0;
                        return { id: m.id, label: m.title, value: v };
                      })}
                    />
                  );
                })()}
                {wp.nextTask ? <div className="mt-2 truncate text-[0.8125rem] text-ink">Next: {wp.nextTask.title}</div> : null}
              </div>
            </button>
          ))}
        </div>
      )}
      {creating ? <NewProjectSheet onClose={() => setCreating(false)} onCreated={(id) => navigate(`/projects/${id}`)} /> : null}
    </Page>
  );
}

function NewProjectSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const trackers = useLiveQuery(() => db.trackers.filter((t) => !t.archived).toArray(), []) ?? [];
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [kind, setKind] = useState<ProjectKind>('portfolio');
  const [trackerId, setTrackerId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);

  const save = async () => {
    if (!title.trim()) return;
    const p = await createProject({
      title, summary: summary || undefined, kind, trackerId: trackerId || trackers[0]?.id,
      targetDate: targetDate || null, milestones: useTemplate ? SOFTWARE_TEMPLATE : [], status: 'planning',
    });
    toast.success('Project created');
    onClose();
    onCreated(p.id);
  };

  return (
    <Modal open onClose={onClose} title="New project" size="md"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim()} onClick={() => void save()}>Create</Button></div>}>
      <div className="space-y-4">
        <Field label="Name" required><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Phishing URL detector" /></Field>
        <Field label="One-line summary"><Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value as ProjectKind)}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select></Field>
          <Field label="Counts toward"><Select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>{trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Target date"><Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-3 text-[0.9375rem] text-ink">
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-accent))]" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
          Start with milestones: {SOFTWARE_TEMPLATE.join(' → ')}
        </label>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* Project workspace                                                   */
/* ================================================================== */

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const { projects, milestones, tasks } = useProjectData();
  const project = projects.find((p) => p.id === projectId);
  const today = todayKey();
  if (!project) {
    return (
      <Page title="Project">
        <EmptyState title="Project not found" action={<Link to="/projects"><Button>Back to projects</Button></Link>} />
      </Page>
    );
  }
  const ms = milestones.filter((m) => m.goalId === project.goalId).sort((a, b) => a.sortOrder - b.sortOrder);
  const ts = tasks.filter((t) => t.goalId === project.goalId);
  const wp = workProgress(ms, ts, today);
  return <ProjectWorkspace project={project} milestones={ms} tasks={ts} wp={wp} today={today} />;
}

function ProjectWorkspace({
  project, milestones, tasks, wp, today,
}: {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
  wp: ReturnType<typeof workProgress>;
  today: string;
}) {
  const health = projectHealth(project, wp, today);
  const [newMilestone, setNewMilestone] = useState('');
  const [newDeliverable, setNewDeliverable] = useState('');
  const [notes, setNotes] = useState(project.notes ?? '');
  const loose = tasks.filter((t) => !t.milestoneId && t.status !== 'cancelled');

  return (
    <Page
      title={project.title}
      subtitle={project.summary}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/projects"><Button variant="ghost" iconLeft={<ArrowLeft className="h-4 w-4" />}>Projects</Button></Link>
          <Link to="/schedule"><Button variant="secondary" iconLeft={<CalendarPlus className="h-4 w-4" />}>Auto Plan</Button></Link>
        </div>
      )}
    >
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Progress" value={`${Math.round(wp.progress * 100)}%`} caption={<HealthChip health={health} />} />
        <MetricTile label="Milestones" value={`${wp.milestonesDone}/${wp.milestonesTotal}`} />
        <MetricTile label="Tasks" value={`${wp.tasksDone}/${wp.tasksTotal}`} caption={wp.overdueTasks ? `${wp.overdueTasks} overdue` : undefined} tone={wp.overdueTasks ? 'caution' : 'default'} />
        <MetricTile label="Target" value={project.targetDate ? formatDateKeyShort(project.targetDate) : '—'} caption={project.targetDate ? relativeDayLabel(project.targetDate, today) : 'Set a date to track health'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {milestones.map((m) => (
            <MilestoneGroup key={m.id} project={project} milestone={m} tasks={tasks.filter((t) => t.milestoneId === m.id)} />
          ))}
          {loose.length ? <MilestoneGroup project={project} milestone={null} tasks={loose} /> : null}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newMilestone.trim()) void createMilestone(project.goalId, newMilestone.trim()).then(() => setNewMilestone('')); }}>
            <Input value={newMilestone} onChange={(e) => setNewMilestone(e.target.value)} placeholder="Add a milestone" />
            <Button type="submit" disabled={!newMilestone.trim()}>Add</Button>
          </form>
          {milestones.length === 0 && loose.length === 0 ? (
            <p className="text-[0.8125rem] text-ink-muted">
              Break the project into milestones, then add tasks with time estimates. Auto Plan places open tasks into your matching blocks.
            </p>
          ) : null}
        </div>

        <aside className="space-y-6">
          <InsetGroup header="Details">
            <div className="space-y-3 px-4 py-3">
              <Field label="Status">
                <Select value={project.status} onChange={(e) => void updateProject(project.id, { status: e.target.value as ProjectStatus })}>
                  {PROJECT_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start"><Input type="date" value={project.startDate ?? ''} onChange={(e) => void updateProject(project.id, { startDate: e.target.value || null })} /></Field>
                <Field label="Target"><Input type="date" value={project.targetDate ?? ''} onChange={(e) => void updateProject(project.id, { targetDate: e.target.value || null })} /></Field>
              </div>
              <Field label="Repository"><Input value={project.repoUrl ?? ''} placeholder="https://github.com/…" onChange={(e) => void updateProject(project.id, { repoUrl: e.target.value || undefined })} /></Field>
              <Field label="Demo / store link"><Input value={project.demoUrl ?? ''} placeholder="https://…" onChange={(e) => void updateProject(project.id, { demoUrl: e.target.value || undefined })} /></Field>
              <div className="flex gap-3">
                {project.repoUrl ? <a className="inline-flex items-center gap-1 text-[0.8125rem] text-accent-ink" href={project.repoUrl} target="_blank" rel="noreferrer"><GitBranch className="h-3.5 w-3.5" />Repo</a> : null}
                {project.demoUrl ? <a className="inline-flex items-center gap-1 text-[0.8125rem] text-accent-ink" href={project.demoUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />Demo</a> : null}
              </div>
            </div>
          </InsetGroup>

          <InsetGroup header="Deliverables" footer={project.definitionOfDone ? `Done means: ${project.definitionOfDone}` : 'README, demo video, tests, write-up…'}>
            {project.deliverables.map((d) => (
              <Row key={d.id}
                leading={<CheckCircle checked={!!d.doneAt} label={d.title} onToggle={() => void toggleDeliverable(project.id, d.id)} />}
                title={<span className={d.doneAt ? 'text-ink-faint line-through' : undefined}>{d.title}</span>} />
            ))}
            <form className="flex gap-2 px-4 py-2" onSubmit={(e) => { e.preventDefault(); if (newDeliverable.trim()) void addDeliverable(project.id, newDeliverable.trim()).then(() => setNewDeliverable('')); }}>
              <Input value={newDeliverable} onChange={(e) => setNewDeliverable(e.target.value)} placeholder="Add a deliverable" />
            </form>
          </InsetGroup>

          <InsetGroup header="Portfolio write-up" footer="Becomes your case study when you pitch a client.">
            <div className="space-y-2 px-4 py-3">
              {(['problem', 'solution', 'stack', 'role', 'results'] as const).map((k) => (
                <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)}>
                  <Textarea rows={k === 'stack' || k === 'role' ? 1 : 2} defaultValue={project.portfolio?.[k] ?? ''}
                    onBlur={(e) => void updateProject(project.id, { portfolio: { ...(project.portfolio ?? {}), [k]: e.target.value || undefined } })} />
                </Field>
              ))}
            </div>
          </InsetGroup>

          <InsetGroup header="Notes">
            <Textarea rows={5} className="rounded-none border-0 bg-transparent" value={notes}
              onChange={(e) => setNotes(e.target.value)} onBlur={() => void updateProject(project.id, { notes })}
              placeholder="Architecture decisions, links, lessons…" />
          </InsetGroup>
        </aside>
      </div>
    </Page>
  );
}

function MilestoneGroup({ project, milestone, tasks }: { project: Project; milestone: Milestone | null; tasks: Task[] }) {
  const [draft, setDraft] = useState('');
  const [minutes, setMinutes] = useState('60');
  const live = tasks.filter((t) => t.status !== 'cancelled');
  const done = live.filter((t) => t.status === 'completed').length;

  const toggleTask = async (t: Task) => {
    if (t.status === 'completed') await setTaskStatus(t.id, 'planned');
    else {
      await setTaskStatus(t.id, 'completed', { actualMinutes: t.estimatedMinutes });
      toast.success('Task completed', milestone && done + 1 === live.length ? `Milestone “${milestone.title}” reached` : undefined);
    }
  };

  return (
    <InsetGroup
      header={milestone ? milestone.title : 'Other tasks'}
      action={milestone ? (
        <div className="flex items-center gap-1">
          {live.length === 0 ? (
            <Button size="xs" variant="ghost" onClick={() => void toggleMilestone(milestone.id)}>{milestone.completedAt ? 'Reopen' : 'Mark reached'}</Button>
          ) : null}
          <IconButton label="Delete milestone" size="xs" variant="ghost" onClick={() => void deleteMilestone(milestone.id)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
        </div>
      ) : undefined}
      footer={milestone ? (milestone.completedAt ? 'Reached — counts toward goal progress and XP.' : live.length ? `${done}/${live.length} tasks · completes automatically when every task is done` : 'No tasks yet — add some, or mark it reached manually.') : undefined}
    >
      {live.map((t) => (
        <Row key={t.id}
          leading={<CheckCircle checked={t.status === 'completed'} label={t.title} onToggle={() => void toggleTask(t)} />}
          title={<span className={t.status === 'completed' ? 'text-ink-faint line-through' : undefined}>{t.title}</span>}
          subtitle={[t.estimatedMinutes ? `${t.estimatedMinutes} min` : null, t.dueDate ? `due ${formatDateKeyShort(t.dueDate)}` : null, t.status === 'planned' ? 'scheduled' : null].filter(Boolean).join(' · ') || undefined}
          trailing={t.status !== 'completed' ? (
            <Input type="date" aria-label="Due date" className="h-8 w-[8.5rem] text-xs" value={t.dueDate ?? ''} onChange={(e) => void updateTask(t.id, { dueDate: e.target.value || null })} />
          ) : undefined}
        />
      ))}
      <form className="flex gap-2 px-4 py-2" onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        void addProjectTask(project, draft.trim(), { milestoneId: milestone?.id ?? null, estimatedMinutes: Number(minutes) || 60 }).then(() => setDraft(''));
      }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a task" />
        <Select aria-label="Estimate" className="w-[6.5rem]" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
          {[15, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m} min</option>)}
        </Select>
      </form>
    </InsetGroup>
  );
}
