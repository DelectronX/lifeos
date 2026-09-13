import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, LayoutGrid, Play, Plus, SkipForward } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Ring } from '@/components/ui/Progress';
import { toast } from '@/state/toastStore';
import {
  useBlocksForDay, useDashboardLayout, useLiveProfile, useNow, useTasks,
} from '@/state/useLiveData';
import { completeBlock, skipBlock, startBlock } from '@/services/scheduleService';
import { sectionTasks, summarise } from '@/services/taskQuery';
import { setDashboardLayout } from '@/services/settingsService';
import { formatDateKeyLong, formatDuration, formatTime, todayKey } from '@/lib/date';
import { SlippedTasksBanner } from '@/features/schedule/AutoRescheduleReview';
import { WIDGET_REGISTRY } from './widgets/registry';
import { addWidget, availableWidgetTypes, removeWidget, reorderWidgets } from './widgets/layout';
import { AddWidgetSheet } from './widgets/AddWidgetSheet';
import { WidgetSlot, useDragReorder } from './widgets/WidgetSlot';
import type { DashboardWidgetSize } from '@/types';

/**
 * Home — a widget-based, user-customizable dashboard.
 *
 * The "now/next" hero stays fixed chrome (it is the one thing every day
 * needs, not a removable insight). Everything below it is the user's own
 * arrangement of widgets, stored in `settings.dashboardLayout` and rendered
 * generically from {@link WIDGET_REGISTRY} — adding a widget type to that
 * registry is the only change needed to make it available here.
 */
export function HomePage() {
  const today = todayKey();
  const now = useNow(30_000);
  const profile = useLiveProfile();
  const tasks = useTasks();
  const blocks = useBlocksForDay(today);
  const layout = useDashboardLayout();

  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { draggedId, setDraggedId, overId, setOverId } = useDragReorder();

  const sections = useMemo(() => sectionTasks(tasks, today), [tasks, today]);
  const activeBlocks = blocks.filter((b) => b.status !== 'cancelled');
  const currentBlock = activeBlocks.find((b) => b.start <= now && b.end > now && b.status !== 'skipped' && b.status !== 'completed');
  const nextBlock = activeBlocks
    .filter((b) => b.start > now && (b.status === 'planned' || b.status === 'in_progress'))
    .sort((a, b) => a.start - b.start)[0];
  const nextTask = sections.overdue[0] ?? sections.today[0] ?? sections.upcoming[0];

  const greeting = greetingFor(new Date(now).getHours(), profile?.displayName);
  const visibleWidgets = layout.filter((w) => !w.hidden);
  const available = availableWidgetTypes(layout);

  async function handleAdd(type: Parameters<typeof addWidget>[1]) {
    await setDashboardLayout(addWidget(layout, type));
  }
  async function handleRemove(id: string) {
    await setDashboardLayout(removeWidget(layout, id));
  }
  async function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setOverId(null); return; }
    const from = layout.findIndex((w) => w.id === draggedId);
    const to = layout.findIndex((w) => w.id === targetId);
    setDraggedId(null);
    setOverId(null);
    if (from === -1 || to === -1) return;
    await setDashboardLayout(reorderWidgets(layout, from, to));
  }

  return (
    <Page
      title={greeting}
      subtitle={formatDateKeyLong(today)}
      actions={
        <Button
          size="sm"
          variant={editing ? 'primary' : 'secondary'}
          iconLeft={<LayoutGrid className="h-3.5 w-3.5" />}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Done' : 'Customize Home'}
        </Button>
      }
    >
      <SlippedTasksBanner className="mb-6" />

      {/* Now / Next — fixed chrome, not a removable widget. */}
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
                    {formatTime(currentBlock.start)}–{formatTime(currentBlock.end)} ·{' '}
                    {formatDuration(Math.max(0, (currentBlock.end - now) / 60_000))} left
                  </div>
                </div>
                <div className="flex gap-2">
                  {currentBlock.status === 'planned' ? (
                    <Button size="sm" iconLeft={<Play className="h-3.5 w-3.5" />} onClick={async () => { await startBlock(currentBlock.id); toast.success('Started'); }}>
                      Start
                    </Button>
                  ) : null}
                  <Button size="sm" variant="primary" iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={async () => { await completeBlock(currentBlock.id); toast.success('Completed'); }}>
                    Complete
                  </Button>
                  <Button size="sm" iconLeft={<SkipForward className="h-3.5 w-3.5" />} onClick={async () => { await skipBlock(currentBlock.id); toast.success('Skipped'); }}>
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
                  <div className="t-meta mt-1">Not scheduled yet · {formatDuration(nextTask.estimatedMinutes)} estimated</div>
                </div>
                <Button size="sm" variant="primary"><Link to="/tasks">Schedule it</Link></Button>
              </div>
            </>
          ) : (
            <>
              <span className="t-label">Next up</span>
              <p className="t-muted mt-2">Nothing scheduled and nothing due. Open the schedule to plan the day.</p>
              <Button size="sm" className="mt-3" iconLeft={<CalendarDays className="h-3.5 w-3.5" />}>
                <Link to="/schedule">Open schedule</Link>
              </Button>
            </>
          )}
        </Card>

        <Card className="flex items-center gap-4">
          <Ring value={todayProgress(sections, activeBlocks)} size={72} stroke={7} color={todayProgress(sections, activeBlocks) >= 1 ? 'positive' : 'accent'}>
            <span className="t-num text-sm font-semibold text-ink">{Math.round(todayProgress(sections, activeBlocks) * 100)}%</span>
          </Ring>
          <div className="min-w-0">
            <div className="t-label">Today</div>
            <div className="t-num mt-1 text-sm text-ink">
              {summarise(tasks, today).completed} of {tasks.length} tasks done
            </div>
          </div>
        </Card>
      </div>

      {/* Widget dashboard */}
      {visibleWidgets.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-7 w-7" />}
          title="Make Home yours"
          description="Choose the insights you want to see every day."
          action={<Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setPickerOpen(true)}>Customize Home</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleWidgets.map((widget) => {
              const def = WIDGET_REGISTRY[widget.type];
              if (!def) return null;
              const Component = def.component;
              return (
                <WidgetSlot
                  key={widget.id}
                  editing={editing}
                  dragging={draggedId === widget.id}
                  isOver={overId === widget.id}
                  sizeClass={sizeClassFor(widget.size)}
                  onRemove={() => handleRemove(widget.id)}
                  onDragStart={() => setDraggedId(widget.id)}
                  onDragEnd={() => { setDraggedId(null); setOverId(null); }}
                  onDragOver={() => setOverId(widget.id)}
                  onDrop={() => handleDrop(widget.id)}
                >
                  <Component config={widget} />
                </WidgetSlot>
              );
            })}
            {editing ? (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex min-h-[7rem] items-center justify-center rounded-card border border-dashed border-line text-sm text-ink-muted transition-colors hover:border-accent/50 hover:text-ink"
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add widget
              </button>
            ) : null}
          </div>
          {!editing ? (
            <div className="mt-4">
              <Button size="sm" variant="ghost" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
                Add or rearrange widgets
              </Button>
            </div>
          ) : null}
        </>
      )}

      <AddWidgetSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        availableTypes={available}
        onAdd={handleAdd}
      />
    </Page>
  );
}

function sizeClassFor(size: DashboardWidgetSize): string {
  if (size === 'large') return 'sm:col-span-2 lg:col-span-3';
  if (size === 'medium') return 'sm:col-span-2 lg:col-span-1';
  return '';
}

function todayProgress(
  sections: ReturnType<typeof sectionTasks>,
  activeBlocks: ReturnType<typeof useBlocksForDay>,
): number {
  const dueToday = [...sections.overdue, ...sections.today];
  const doneTasks = dueToday.filter((t) => t.status === 'completed').length;
  const doneBlocks = activeBlocks.filter((b) => b.status === 'completed').length;
  const total = dueToday.length + activeBlocks.length;
  return total > 0 ? (doneTasks + doneBlocks) / total : 0;
}

function greetingFor(hour: number, name?: string): string {
  const part = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Good night';
  return name ? `${part}, ${name}` : part;
}
