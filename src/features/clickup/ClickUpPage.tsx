import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Columns3, ExternalLink, Flag, Folder, Globe, LayoutList, Link2,
  List as ListIcon, LogOut, MessageSquare, Play, Plug, Plus, RefreshCw, Search, ShieldCheck, Square, SquareKanban, User,
} from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { db } from '@/db/db';
import { cn } from '@/lib/cn';
import { formatDateKeyShort, toDateKey, todayKey } from '@/lib/date';
import { toast } from '@/state/toastStore';
import { clickup, ClickUpClientError, type ClickUpStatus } from '@/integrations/clickup/client';
import { linkClickUpTask, syncAllLinkedTasks, syncLinkedTask, unlinkTask, isClickUpLinked } from '@/integrations/clickup/linkService';
import {
  PRIORITY_LABELS, isClosedStatus, type CUComment, type CUList, type CUSpace, type CUStatus, type CUTask, type CUTeam, type CUTimeEntry,
} from '@/integrations/clickup/shared';
import type { Task } from '@/types';

/**
 * ClickUp inside LifeOS (hybrid integration).
 *
 * The real ClickUp app cannot be framed (ClickUp sends
 * `frame-ancestors 'self' clickup.com`), so this page is a native LifeOS
 * workspace built from ClickUp's API via the local LifeOS server: browse
 * Spaces → Folders → Lists, list and board views, a task drawer with status,
 * priority, due date, comments and timers, and "Add to LifeOS" to time-block a
 * ClickUp task. Public ClickUp shares / forms / docs that allow framing are
 * shown in the Embeds tab; everything else opens in ClickUp.
 */

const TEAM_KEY = 'lifeos.clickup.team';
const EMBEDS_KEY = 'lifeos.clickup.embeds';
const TRACKER_KEY = 'lifeos.clickup.tracker';

type Scope = { kind: 'my' } | { kind: 'list'; listId: string; name: string; path: string };
type View = 'list' | 'board' | 'embeds';

const listUrl = (teamId: string, listId: string) => `https://app.clickup.com/${teamId}/v/li/${listId}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function readJson<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export function ClickUpPage() {
  const [status, setStatus] = useState<ClickUpStatus | null>(null);
  const [problem, setProblem] = useState<ClickUpClientError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStatus(await clickup.status()); setProblem(null); }
    catch (e) { setProblem(e instanceof ClickUpClientError ? e : new ClickUpClientError('ERROR', errText(e), 0)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Page
      wide
      title="ClickUp"
      subtitle="Your ClickUp workspace inside LifeOS. Plan ClickUp work on your calendar; completion syncs both ways."
    >
      {loading && !status && !problem ? <p className="text-center text-sm text-ink-muted">Connecting to the LifeOS server…</p> : null}
      {problem ? <ServerProblem error={problem} onRetry={() => void load()} /> : null}
      {status && !status.connected ? <ConnectCard onConnected={(s) => setStatus(s)} /> : null}
      {status?.connected ? <Workspace status={status} onDisconnected={() => void load()} /> : null}
    </Page>
  );
}

function ServerProblem({ error, onRetry }: { error: ClickUpClientError; onRetry: () => void }) {
  const setup = error.code === 'AGENT_NOT_SET_UP';
  return (
    <EmptyState
      icon={<Plug />}
      title={setup ? 'Connect the local LifeOS server first' : 'The LifeOS server is not reachable'}
      description={setup
        ? 'ClickUp runs through the LifeOS server on this PC, so your ClickUp key never sits in the browser. Start it, then paste its token in Settings → Agents.'
        : error.message}
      action={(
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/settings?tab=agents"><Button variant="primary">Open Settings → Agents</Button></Link>
          <Button onClick={onRetry} iconLeft={<RefreshCw className="h-4 w-4" />}>Retry</Button>
        </div>
      )}
    />
  );
}

function ConnectCard({ onConnected }: { onConnected: (s: ClickUpStatus) => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = async () => {
    setBusy(true); setError(null);
    try {
      const s = await clickup.connect(token.trim());
      setToken('');
      toast.success('ClickUp connected', s.user ? `Signed in as ${s.user.name}` : undefined);
      onConnected(s);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-xl surface-card rounded-panel p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent-ink"><Plug className="h-5 w-5" /></div>
        <div>
          <h2 className="text-base font-semibold text-ink">Connect ClickUp</h2>
          <p className="text-sm text-ink-muted">Use a personal API token from your ClickUp account.</p>
        </div>
      </div>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
        <li>In ClickUp, open your avatar → <b className="text-ink">Settings</b> → <b className="text-ink">Apps</b>.</li>
        <li>Under <b className="text-ink">API Token</b>, click Generate (or Copy) — it starts with <code>pk_</code>.</li>
        <li>Paste it below.</li>
      </ol>
      <Field label="Personal API token" error={error ?? undefined}>
        <Input
          type="password" autoComplete="off" spellCheck={false} value={token} placeholder="pk_…"
          aria-label="ClickUp personal API token" onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && token.trim()) void connect(); }}
        />
      </Field>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-ink-faint"><ShieldCheck className="h-3.5 w-3.5" /> Stored only on this PC by the LifeOS server, never in the browser or backups.</p>
        <Button variant="primary" loading={busy} disabled={!token.trim()} onClick={() => void connect()}>Connect</Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Connected workspace                                                 */
/* ================================================================== */

function Workspace({ status, onDisconnected }: { status: ClickUpStatus; onDisconnected: () => void }) {
  const [teams, setTeams] = useState<CUTeam[]>([]);
  const [teamId, setTeamId] = useState<string>(() => localStorage.getItem(TEAM_KEY) ?? '');
  const [tree, setTree] = useState<CUSpace[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>({ kind: 'my' });
  const [view, setView] = useState<View>('list');

  useEffect(() => {
    clickup.teams().then((t) => {
      setTeams(t);
      if (!t.some((x) => x.id === teamId) && t[0]) setTeamId(t[0].id);
    }).catch((e) => setTreeError(errText(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTree = useCallback(async (fresh = false) => {
    if (!teamId) return;
    localStorage.setItem(TEAM_KEY, teamId);
    setTreeError(null);
    try { setTree(await clickup.tree(teamId, fresh)); } catch (e) { setTreeError(errText(e)); }
  }, [teamId]);
  useEffect(() => { setTree(null); void loadTree(); }, [loadTree]);

  const disconnect = async () => {
    if (!window.confirm('Disconnect ClickUp? Linked LifeOS tasks stay; they just stop syncing.')) return;
    await clickup.disconnect();
    toast.show('ClickUp disconnected');
    onDisconnected();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="surface-card flex flex-col rounded-panel p-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)]">
        {teams.length > 1 ? (
          <Select aria-label="ClickUp workspace" value={teamId} onChange={(e) => { setTeamId(e.target.value); setScope({ kind: 'my' }); }} className="mb-2">
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        ) : <div className="px-2 pb-2 text-[0.8125rem] font-semibold text-ink">{teams[0]?.name ?? 'Workspace'}</div>}
        <SideItem active={scope.kind === 'my'} icon={<User className="h-4 w-4" />} label="My tasks" onClick={() => setScope({ kind: 'my' })} />
        <div className="mt-2 flex items-center justify-between px-2 py-1">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint">Spaces</span>
          <IconButton label="Refresh workspace" size="xs" variant="ghost" onClick={() => void loadTree(true)}><RefreshCw className="h-3.5 w-3.5" /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {treeError ? <p className="px-2 text-xs text-critical">{treeError}</p> : null}
          {!tree && !treeError ? <p className="px-2 text-xs text-ink-muted">Loading…</p> : null}
          {tree?.map((space) => <SpaceNode key={space.id} space={space} scope={scope} onPick={setScope} />)}
          {tree && tree.length === 0 ? <p className="px-2 text-xs text-ink-muted">No spaces in this workspace.</p> : null}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-line/60 px-2 pt-3">
          <span className="truncate text-xs text-ink-muted" title={status.user?.email ?? undefined}>{status.user?.name ?? 'Connected'}</span>
          <Button size="xs" variant="ghost" iconLeft={<LogOut className="h-3.5 w-3.5" />} onClick={() => void disconnect()}>Disconnect</Button>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs text-ink-faint">{scope.kind === 'list' ? scope.path : 'Assigned to you, across the workspace'}</div>
            <h2 className="truncate text-xl font-semibold text-ink">{scope.kind === 'list' ? scope.name : 'My tasks'}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<View>
              size="sm" aria-label="View" value={view} onChange={setView}
              items={[
                { value: 'list', label: 'List', icon: <LayoutList className="h-3.5 w-3.5" /> },
                { value: 'board', label: 'Board', icon: <Columns3 className="h-3.5 w-3.5" /> },
                { value: 'embeds', label: 'Embeds', icon: <Globe className="h-3.5 w-3.5" /> },
              ]}
            />
            <a href={scope.kind === 'list' && teamId ? listUrl(teamId, scope.listId) : `https://app.clickup.com/${teamId}/home`} target="_blank" rel="noreferrer">
              <Button size="sm" iconLeft={<ExternalLink className="h-3.5 w-3.5" />}>Open in ClickUp</Button>
            </a>
          </div>
        </div>
        {view === 'embeds'
          ? <Embeds />
          : <TaskArea key={`${teamId}:${scope.kind === 'list' ? scope.listId : 'my'}`} teamId={teamId} scope={scope} view={view} />}
        <LinkedTasksPanel />
      </section>
    </div>
  );
}

function SideItem({ active, icon, label, onClick, indent = 0, color }: { active: boolean; icon: ReactNode; label: string; onClick: () => void; indent?: number; color?: string | null }) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn('touch-hit flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.8125rem] transition-colors',
        active ? 'bg-accent/12 font-medium text-accent-ink' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink')}
      style={{ paddingLeft: `${0.5 + indent * 0.875}rem` }}
    >
      <span className="shrink-0" style={color ? { color } : undefined}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function SpaceNode({ space, scope, onPick }: { space: CUSpace; scope: Scope; onPick: (s: Scope) => void }) {
  const [open, setOpen] = useState(true);
  const pick = (list: CUList, folder?: string) => onPick({ kind: 'list', listId: list.id, name: list.name, path: [space.name, folder].filter(Boolean).join(' / ') });
  const isActive = (id: string) => scope.kind === 'list' && scope.listId === id;
  return (
    <div className="mb-1">
      <SideItem active={false} icon={open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} label={space.name} onClick={() => setOpen(!open)} color={space.color} />
      {open ? (
        <>
          {space.folders.map((f) => (
            <div key={f.id}>
              <div className="flex items-center gap-2 py-1 text-[0.75rem] text-ink-faint" style={{ paddingLeft: '1.375rem' }}><Folder className="h-3.5 w-3.5" />{f.name}</div>
              {f.lists.map((l) => <SideItem key={l.id} indent={2} active={isActive(l.id)} icon={<ListIcon className="h-3.5 w-3.5" />} label={l.name} onClick={() => pick(l, f.name)} />)}
            </div>
          ))}
          {space.lists.map((l) => <SideItem key={l.id} indent={1} active={isActive(l.id)} icon={<ListIcon className="h-3.5 w-3.5" />} label={l.name} onClick={() => pick(l)} />)}
        </>
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* Tasks: list + board                                                 */
/* ================================================================== */

function useLinkedIds(): Map<string, Task> {
  const linked = useLiveQuery(() => db.tasks.filter((t) => t.external?.provider === 'clickup').toArray(), []) ?? [];
  return useMemo(() => new Map(linked.map((t) => [t.external!.id, t])), [linked]);
}

function TaskArea({ teamId, scope, view }: { teamId: string; scope: Scope; view: 'list' | 'board' }) {
  const [tasks, setTasks] = useState<CUTask[] | null>(null);
  const [list, setList] = useState<CUList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [lastPage, setLastPage] = useState(true);
  const [page, setPage] = useState(0);
  const linked = useLinkedIds();

  const load = useCallback(async (p = 0) => {
    setError(null);
    try {
      const r = scope.kind === 'list'
        ? await clickup.tasks(scope.listId, { page: p, closed: showClosed })
        : await clickup.myTasks(teamId, { page: p, closed: showClosed });
      setTasks((prev) => (p === 0 ? r.tasks : [...(prev ?? []), ...r.tasks]));
      setLastPage(r.lastPage); setPage(p);
      if (scope.kind === 'list') setList(await clickup.list(scope.listId));
    } catch (e) { setError(errText(e)); }
  }, [scope, teamId, showClosed]);
  useEffect(() => { setTasks(null); void load(0); }, [load]);

  const replace = (t: CUTask) => setTasks((prev) => prev?.map((x) => (x.id === t.id ? t : x)) ?? prev);
  const shown = (tasks ?? []).filter((t) => !query.trim() || t.name.toLowerCase().includes(query.trim().toLowerCase()));
  const open = tasks?.find((t) => t.id === openId) ?? null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input aria-label="Filter tasks" placeholder="Filter tasks" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
        </label>
        <IconButton label="Reload tasks" size="sm" variant="ghost" onClick={() => void load(0)}><RefreshCw className="h-4 w-4" /></IconButton>
      </div>
      {scope.kind === 'list' ? <QuickCreate listId={scope.listId} onCreated={(t) => setTasks((prev) => [t, ...(prev ?? [])])} /> : null}
      {error ? <p className="mb-3 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">{error}</p> : null}
      {!tasks && !error ? <p className="py-10 text-center text-sm text-ink-muted">Loading tasks…</p> : null}
      {tasks && shown.length === 0 ? (
        <EmptyState size="sm" icon={<CheckCircle2 />} title={query ? 'No matching tasks' : 'Nothing here'} description={scope.kind === 'my' ? 'No open tasks are assigned to you.' : 'This list has no open tasks.'} />
      ) : null}
      {tasks && shown.length > 0 && view === 'list' ? (
        <div className="surface-card divide-y divide-line/50 overflow-hidden rounded-panel">
          {shown.map((t) => <TaskRow key={t.id} task={t} linked={linked.get(t.id)} onOpen={() => setOpenId(t.id)} showList={scope.kind === 'my'} />)}
        </div>
      ) : null}
      {tasks && shown.length > 0 && view === 'board' ? <Board tasks={shown} statuses={list?.statuses} linked={linked} onOpen={setOpenId} /> : null}
      {tasks && !lastPage ? <div className="mt-3 text-center"><Button size="sm" onClick={() => void load(page + 1)}>Load more</Button></div> : null}
      {open ? <TaskDrawer task={open} teamId={teamId} linked={linked.get(open.id)} onChange={replace} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function StatusPill({ status }: { status: CUStatus }) {
  return (
    <span className="inline-flex max-w-[9rem] items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: `${status.color}26`, color: status.color }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />{status.name}
    </span>
  );
}

function DueLabel({ due }: { due: number | null }) {
  if (!due) return null;
  const key = toDateKey(due);
  const overdue = key < todayKey();
  return <span className={cn('whitespace-nowrap text-xs', overdue ? 'font-medium text-critical' : 'text-ink-muted')}>{formatDateKeyShort(key)}</span>;
}

function PriorityFlag({ task }: { task: CUTask }) {
  if (!task.priority) return null;
  return <Flag aria-label={`${task.priority.label} priority`} className="h-3.5 w-3.5 shrink-0" style={{ color: task.priority.color }} />;
}

function TaskRow({ task, linked, onOpen, showList }: { task: CUTask; linked?: Task; onOpen: () => void; showList: boolean }) {
  const closed = isClosedStatus(task.status);
  return (
    <button type="button" onClick={onOpen} className="touch-hit flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-sunken/60">
      <StatusPill status={task.status} />
      <span className={cn('min-w-0 flex-1 truncate text-sm', closed ? 'text-ink-faint line-through' : 'text-ink')}>{task.name}</span>
      {showList ? <span className="hidden truncate text-xs text-ink-faint md:inline">{task.list.name}</span> : null}
      {linked ? <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[0.6875rem] font-medium text-accent-ink"><Link2 className="h-3 w-3" />LifeOS</span> : null}
      {task.subtasks.length ? <span className="text-xs text-ink-faint">{task.subtasks.filter((s) => isClosedStatus(s.status)).length}/{task.subtasks.length}</span> : null}
      <PriorityFlag task={task} />
      <DueLabel due={task.dueDate} />
      <span className="flex -space-x-1.5">
        {task.assignees.slice(0, 3).map((a) => (
          <span key={a.id} title={a.name} className="flex h-6 w-6 items-center justify-center rounded-full text-[0.625rem] font-semibold text-white ring-2 ring-surface" style={{ backgroundColor: a.color }}>{a.initials}</span>
        ))}
      </span>
    </button>
  );
}

function Board({ tasks, statuses, linked, onOpen }: { tasks: CUTask[]; statuses?: CUStatus[]; linked: Map<string, Task>; onOpen: (id: string) => void }) {
  const columns = useMemo(() => {
    const cols = new Map<string, { status: CUStatus; tasks: CUTask[] }>();
    for (const s of statuses ?? []) cols.set(s.name, { status: s, tasks: [] });
    for (const t of tasks) {
      if (!cols.has(t.status.name)) cols.set(t.status.name, { status: t.status, tasks: [] });
      cols.get(t.status.name)!.tasks.push(t);
    }
    return [...cols.values()].sort((a, b) => a.status.order - b.status.order);
  }, [tasks, statuses]);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((c) => (
        <div key={c.status.name} className="w-72 shrink-0 rounded-panel bg-surface-raised/50 p-2">
          <div className="mb-2 flex items-center justify-between px-1"><StatusPill status={c.status} /><span className="text-xs text-ink-faint">{c.tasks.length}</span></div>
          <div className="space-y-2">
            {c.tasks.map((t) => (
              <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="surface-card block w-full rounded-xl p-3 text-left transition-colors hover:bg-surface-sunken/60">
                <div className="mb-2 text-sm text-ink">{t.name}</div>
                <div className="flex items-center gap-2">
                  <PriorityFlag task={t} /><DueLabel due={t.dueDate} />
                  {linked.has(t.id) ? <Link2 aria-label="Linked to LifeOS" className="h-3.5 w-3.5 text-accent-ink" /> : null}
                  <span className="ml-auto truncate text-[0.6875rem] text-ink-faint">{t.list.name}</span>
                </div>
              </button>
            ))}
            {c.tasks.length === 0 ? <p className="px-1 py-3 text-center text-xs text-ink-faint">Empty</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickCreate({ listId, onCreated }: { listId: string; onCreated: (t: CUTask) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { onCreated(await clickup.createTask({ listId, name: name.trim() })); setName(''); }
    catch (e) { toast.error('Could not create the task', errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mb-3 flex gap-2">
      <Input aria-label="New ClickUp task" placeholder="New task in this list…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
      <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} loading={busy} disabled={!name.trim()} onClick={() => void create()}>Add</Button>
    </div>
  );
}

/* ================================================================== */
/* Task drawer                                                         */
/* ================================================================== */

function TaskDrawer({ task, teamId, linked, onChange, onClose }: { task: CUTask; teamId: string; linked?: Task; onChange: (t: CUTask) => void; onClose: () => void }) {
  const [list, setList] = useState<CUList | null>(null);
  const [comments, setComments] = useState<CUComment[] | null>(null);
  const [comment, setComment] = useState('');
  const [timer, setTimer] = useState<CUTimeEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const trackers = useLiveQuery(() => db.trackers.filter((t) => !t.archived).toArray(), []) ?? [];
  const [trackerId, setTrackerId] = useState<string>(() => localStorage.getItem(TRACKER_KEY) ?? '');
  const navigate = useNavigate();

  useEffect(() => {
    clickup.list(task.list.id).then(setList).catch(() => setList(null));
    clickup.comments(task.id).then(setComments).catch(() => setComments([]));
    if (teamId) clickup.timer(teamId).then(setTimer).catch(() => setTimer(null));
  }, [task.id, task.list.id, teamId]);
  useEffect(() => {
    if (!trackerId && trackers.length) setTrackerId((trackers.find((t) => t.pillar === 'skills') ?? trackers[0])!.id);
  }, [trackers, trackerId]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error('ClickUp', errText(e)); } finally { setBusy(null); }
  };
  const update = (patch: Parameters<typeof clickup.updateTask>[0]) => run('update', async () => {
    onChange(await clickup.updateTask(patch));
    if (linked && isClickUpLinked(linked)) await syncLinkedTask(linked);
  });
  const timingThis = timer?.running && timer.taskId === task.id;

  return (
    <Modal open onClose={onClose} size="lg" title={task.name} description={`${task.list.name}${task.folder ? ` · ${task.folder.name}` : ''}`}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Status">
            <Select aria-label="Status" value={task.status.name} disabled={!list || busy === 'update'} onChange={(e) => void update({ id: task.id, status: e.target.value })}>
              {(list?.statuses ?? [task.status]).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select aria-label="Priority" value={task.priority?.level ?? ''} disabled={busy === 'update'}
              onChange={(e) => void update({ id: task.id, priority: e.target.value ? (Number(e.target.value) as 1 | 2 | 3 | 4) : null })}>
              <option value="">None</option>
              {([1, 2, 3, 4] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p].label}</option>)}
            </Select>
          </Field>
          <Field label="Due date">
            <Input type="date" aria-label="Due date" value={task.dueDate ? toDateKey(task.dueDate) : ''} disabled={busy === 'update'}
              onChange={(e) => void update({ id: task.id, dueDate: e.target.value ? new Date(`${e.target.value}T12:00`).getTime() : null })} />
          </Field>
        </div>

        {task.description.trim() ? <div className="whitespace-pre-wrap rounded-xl bg-surface-sunken/60 p-3 text-sm text-ink-muted">{task.description}</div> : null}

        {task.subtasks.length ? (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Subtasks</h3>
            <ul className="space-y-1">
              {task.subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm"><StatusPill status={s.status} /><span className={isClosedStatus(s.status) ? 'text-ink-faint line-through' : 'text-ink'}>{s.name}</span></li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-xl border border-line/60 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint"><Link2 className="h-3.5 w-3.5" /> In LifeOS</h3>
          {linked ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink">Linked task: <b>{linked.title}</b> · {linked.status === 'completed' ? 'done' : linked.dueDate ? `due ${formatDateKeyShort(linked.dueDate)}` : 'no due date'}</span>
              {linked.external?.conflict ? <span className="inline-flex items-center gap-1 text-xs text-caution"><AlertTriangle className="h-3.5 w-3.5" /> Changed on both sides — finish or reopen it on one side.</span> : null}
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => navigate('/tasks')}>Open in Tasks</Button>
                <Button size="sm" variant="ghost" onClick={() => void run('unlink', async () => { await unlinkTask(linked.id); toast.show('Unlinked', 'The LifeOS task stays; it no longer syncs.'); })}>Unlink</Button>
              </div>
            </div>
          ) : isClosedStatus(task.status) ? (
            <p className="text-sm text-ink-muted">Closed tasks are not imported (finished work is not re-credited).</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Area / subject" className="min-w-[12rem] flex-1">
                <Select aria-label="LifeOS area" value={trackerId} onChange={(e) => { setTrackerId(e.target.value); localStorage.setItem(TRACKER_KEY, e.target.value); }}>
                  {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Button variant="primary" loading={busy === 'link'} disabled={!trackerId} iconLeft={<Plus className="h-4 w-4" />}
                onClick={() => void run('link', async () => {
                  const r = await linkClickUpTask(task, { trackerId, teamId });
                  toast.success(r.created ? 'Added to LifeOS' : 'Already in LifeOS', 'Schedule it on your calendar or let Auto Plan place it.');
                })}>Add to LifeOS</Button>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint"><MessageSquare className="h-3.5 w-3.5" /> Comments</h3>
          {comments === null ? <p className="text-sm text-ink-muted">Loading…</p> : null}
          {comments?.length === 0 ? <p className="text-sm text-ink-faint">No comments yet.</p> : null}
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {comments?.map((c) => (
              <li key={c.id} className="rounded-xl bg-surface-sunken/60 px-3 py-2 text-sm">
                <div className="mb-0.5 text-xs text-ink-faint">{c.author}{c.at ? ` · ${new Date(c.at).toLocaleString()}` : ''}</div>
                <div className="whitespace-pre-wrap text-ink">{c.text}</div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Textarea aria-label="New comment" rows={2} placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
            <Button className="self-end" loading={busy === 'comment'} disabled={!comment.trim()} onClick={() => void run('comment', async () => {
              await clickup.comment(task.id, comment.trim()); setComment(''); setComments(await clickup.comments(task.id));
            })}>Post</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-4">
          <div className="flex gap-2">
            {teamId ? (
              timingThis
                ? <Button iconLeft={<Square className="h-4 w-4" />} loading={busy === 'timer'} onClick={() => void run('timer', async () => { await clickup.stopTimer(teamId); setTimer(null); toast.show('Timer stopped', 'Time logged in ClickUp.'); })}>Stop timer</Button>
                : <Button iconLeft={<Play className="h-4 w-4" />} loading={busy === 'timer'} onClick={() => void run('timer', async () => { setTimer(await clickup.startTimer(teamId, task.id)); toast.show('Timer started in ClickUp'); })}>Start timer</Button>
            ) : null}
            {timer?.running && !timingThis ? <span className="self-center text-xs text-ink-faint">Another ClickUp timer is running{timer.taskName ? ` (${timer.taskName})` : ''}; starting this one stops it.</span> : null}
          </div>
          <a href={task.url} target="_blank" rel="noreferrer"><Button variant="ghost" iconLeft={<ExternalLink className="h-4 w-4" />}>Open in ClickUp</Button></a>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* Linked tasks + sync                                                 */
/* ================================================================== */

function LinkedTasksPanel() {
  const linked = useLiveQuery(() => db.tasks.filter((t) => t.external?.provider === 'clickup').toArray(), []) ?? [];
  const [busy, setBusy] = useState(false);
  if (!linked.length) return null;
  const issues = linked.filter((t) => t.external?.conflict || t.external?.missing);
  const lastAt = Math.max(0, ...linked.map((t) => t.external?.lastSync?.at ?? 0));
  const sync = async () => {
    setBusy(true);
    try {
      const r = await syncAllLinkedTasks();
      const changed = Object.entries(r.actions).filter(([k]) => k !== 'none').map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ');
      if (r.errors.length) toast.error('Sync finished with errors', r.errors[0]);
      else toast.success(`Synced ${r.checked} linked task${r.checked === 1 ? '' : 's'}`, changed || 'Everything already matched.');
    } finally { setBusy(false); }
  };
  return (
    <div className="mt-6 surface-card flex flex-wrap items-center gap-3 rounded-panel px-4 py-3 text-sm">
      <SquareKanban className="h-4 w-4 text-ink-faint" />
      <span className="text-ink">{linked.length} ClickUp task{linked.length === 1 ? '' : 's'} linked to LifeOS</span>
      <span className="text-ink-faint">· {linked.filter((t) => t.status === 'completed').length} done</span>
      {issues.length ? <span className="inline-flex items-center gap-1 text-caution"><AlertTriangle className="h-3.5 w-3.5" />{issues.length} need attention</span> : null}
      <span className="ml-auto text-xs text-ink-faint">{lastAt ? `Last sync ${new Date(lastAt).toLocaleTimeString()}` : 'Not synced yet'} · syncs every 3 min while open</span>
      <Button size="sm" loading={busy} iconLeft={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void sync()}>Sync now</Button>
    </div>
  );
}

/* ================================================================== */
/* Embeds                                                              */
/* ================================================================== */

interface SavedEmbed { id: string; title: string; url: string }

function Embeds() {
  const [items, setItems] = useState<SavedEmbed[]>(() => readJson(EMBEDS_KEY, []));
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const save = (next: SavedEmbed[]) => { setItems(next); localStorage.setItem(EMBEDS_KEY, JSON.stringify(next)); };
  const add = () => {
    try { new URL(url.trim()); } catch { toast.error('That is not a valid link'); return; }
    const item = { id: `emb_${Date.now()}`, title: title.trim() || 'ClickUp view', url: url.trim() };
    save([...items, item]); setActiveId(item.id); setTitle(''); setUrl('');
  };
  const active = items.find((x) => x.id === activeId) ?? null;
  return (
    <div className="space-y-4">
      <div className="surface-card rounded-panel p-4">
        <p className="mb-3 text-sm text-ink-muted">
          Show ClickUp content that ClickUp allows other sites to display: public view links, forms and shared docs
          (in ClickUp: <b className="text-ink">Share → Public link / Embed</b>). Your private workspace pages can't be framed — ClickUp blocks that — so use the List and Board views here, or Open in ClickUp.
        </p>
        <div className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)_auto]">
          <Input aria-label="Embed title" placeholder="Title (e.g. Sprint board)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input aria-label="ClickUp share link" placeholder="https://sharing.clickup.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button variant="primary" disabled={!url.trim()} iconLeft={<Plus className="h-4 w-4" />} onClick={add}>Add</Button>
        </div>
      </div>
      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((x) => (
            <span key={x.id} className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm', x.id === activeId ? 'bg-accent/12 text-accent-ink' : 'bg-surface-raised text-ink-muted')}>
              <button type="button" onClick={() => setActiveId(x.id)}>{x.title}</button>
              <button type="button" aria-label={`Remove ${x.title}`} className="ml-1 text-ink-faint hover:text-critical" onClick={() => { save(items.filter((y) => y.id !== x.id)); if (activeId === x.id) setActiveId(null); }}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      {active ? <EmbedViewer key={active.id} item={active} /> : null}
    </div>
  );
}

function EmbedViewer({ item }: { item: SavedEmbed }) {
  const [verdict, setVerdict] = useState<{ embeddable: boolean; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    clickup.embedCheck(item.url).then(setVerdict).catch((e) => setError(errText(e)));
  }, [item.url]);
  const openLink = <a href={item.url} target="_blank" rel="noreferrer"><Button iconLeft={<ExternalLink className="h-4 w-4" />}>Open in ClickUp</Button></a>;
  if (error) return <EmptyState size="sm" icon={<AlertTriangle />} title="Can't show this link" description={error} action={openLink} />;
  if (!verdict) return <p className="py-10 text-center text-sm text-ink-muted">Checking whether ClickUp allows embedding…</p>;
  if (!verdict.embeddable) return <EmptyState size="sm" icon={<ShieldCheck />} title="ClickUp blocks embedding for this page" description={`${verdict.reason} Make a public share link in ClickUp, or open it there.`} action={openLink} />;
  return (
    <div className="surface-card overflow-hidden rounded-panel">
      <div className="flex items-center justify-between border-b border-line/60 px-4 py-2 text-sm">
        <span className="font-medium text-ink">{item.title}</span>
        <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-ink"><ExternalLink className="h-3.5 w-3.5" /> Open in ClickUp</a>
      </div>
      <iframe
        title={item.title}
        src={item.url}
        className="h-[70vh] w-full bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
    </div>
  );
}
