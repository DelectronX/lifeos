import { requestCompleteBlock } from '@/state/completeBlockStore';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, LayoutGrid, Play, Plus, SkipForward } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import {
  useBlocksForDay, useDashboardLayout, useLiveProfile, useLiveSettings, useNow, useTasks, useTrackerMap,
} from '@/state/useLiveData';
import { DayRibbon, trackerHex } from '@/features/schedule/dayRibbon';
import { ActivityRings, RingLegend, type RingSpec } from './ActivityRings';
import { skipBlock, startBlock } from '@/services/scheduleService';
import { sectionTasks } from '@/services/taskQuery';
import { setDashboardLayout, updateSettings } from '@/services/settingsService';
import { formatDateKeyLong, formatDuration, formatTime, todayKey } from '@/lib/date';
import { SlippedTasksBanner } from '@/features/schedule/AutoRescheduleReview';
import { StorageGuardCard } from '@/features/settings/StorageGuardCard';
import { isRequiredBlock } from '@/engines/customMetrics';
import { RewardReadyCard } from '@/features/achievements/RewardReadyCard';
import { BurnoutGuardCard } from './BurnoutGuardCard';
import { WorkGrowthCard } from './WorkGrowthCard';
import { WIDGET_REGISTRY } from './widgets/registry';
import {
  addWidget, availableWidgetTypes, cycleWidgetSize, introduceWidgets, moveWidget, removeWidget, reorderWidgets, setWidgetHidden,
} from './widgets/layout';
import { WidgetBoundary } from './widgets/WidgetShell';
import { useTodayProgress } from './useTodayProgress';
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
  const requiredToday = activeBlocks.filter((b) => isRequiredBlock(b));
  const nextTask = sections.overdue[0] ?? sections.today[0] ?? sections.upcoming[0];

  const greeting = greetingFor(new Date(now).getHours(), profile?.displayName);
  const trackers = useTrackerMap();
  const progress = useTodayProgress();
  const shownWidgets = editing ? layout : layout.filter((w) => !w.hidden);
  const available = availableWidgetTypes(layout);
  const settings = useLiveSettings();

  // Introduce new widget types once (empty layouts get the recommended set).
  useEffect(() => {
    if (!settings) return;
    const r = introduceWidgets(settings.dashboardLayout ?? [], settings.widgetsIntroduced);
    if (r.changed) void updateSettings({ dashboardLayout: r.layout, widgetsIntroduced: r.introduced });
  }, [settings]);

  async function handleAdd(type: Parameters<typeof addWidget>[1]) {
    await setDashboardLayout(addWidget(layout, type));
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

  const blocksDone = progress.blocks.done;
  const rings: RingSpec[] = [
    { label: 'Blocks', ...progress.blocks, color: 'rgb(var(--c-accent))', textColor: 'rgb(var(--c-accent-ink))' },
    { label: 'Tasks', ...progress.tasks, color: 'rgb(var(--c-positive))' },
    { label: 'Checklists', ...progress.checklists, color: 'rgb(var(--c-caution))' },
  ];
  const nowTracker = currentBlock ? trackers[currentBlock.trackerId] : undefined;
  const nowHex = trackerHex(nowTracker?.color);

  return (
    <Page
      eyebrow={formatDateKeyLong(today)}
      title={greeting}
    >
      {/* Notices: each renders nothing unless it has something to say. */}
      <div className="mb-6 space-y-3 empty:hidden">
        <StorageGuardCard compact />
        <BurnoutGuardCard />
        <RewardReadyCard />
      </div>
      <SlippedTasksBanner className="mb-6" />

      {/* Today — the signature surface: now, rings, and the Day Ribbon. */}
      <section className="surface-card mb-8 overflow-hidden rounded-[var(--r-2xl)]" aria-label="Today">
        <div className="grid gap-8 p-6 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            {currentBlock ? (
              <>
                <div className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-muted dark:text-[var(--now)]" style={{ ['--now' as string]: nowHex }}>
                  <span className="live-dot h-2 w-2 rounded-full" style={{ backgroundColor: nowHex }} />
                  Now{nowTracker ? ` · ${nowTracker.name}` : ''}
                  {currentBlock.status === 'in_progress' ? <span className="font-medium text-ink-faint">· logging</span> : null}
                </div>
                <h2 className="t-title1 mt-2 truncate">{currentBlock.title}</h2>
                <p className="t-num mt-1 text-[0.9375rem] text-ink-muted">
                  {formatTime(currentBlock.start)} – {formatTime(currentBlock.end)}
                  <span className="mx-1.5 text-ink-faint">·</span>
                  <span className="font-semibold text-ink">{formatDuration(Math.max(0, (currentBlock.end - now) / 60_000))}</span> left
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {currentBlock.status === 'planned' ? (
                    <Button variant="primary" iconLeft={<Play className="h-4 w-4 fill-current" />} onClick={async () => { await startBlock(currentBlock.id); toast.success('Started', 'It logs itself when it ends.'); }}>
                      Start
                    </Button>
                  ) : null}
                  <Button variant={currentBlock.status === 'planned' ? 'secondary' : 'primary'} iconLeft={<CheckCircle2 className="h-4 w-4" />} onClick={() => void requestCompleteBlock(currentBlock)}>
                    Done
                  </Button>
                  <Button variant="ghost" iconLeft={<SkipForward className="h-4 w-4" />} onClick={async () => { await skipBlock(currentBlock.id); toast.show('Skipped', currentBlock.title); }}>
                    Skip
                  </Button>
                </div>
              </>
            ) : nextBlock ? (
              <>
                <div className="text-[0.8125rem] font-semibold text-ink-muted">Up next · in {formatDuration(Math.max(0, (nextBlock.start - now) / 60_000))}</div>
                <h2 className="t-title1 mt-2 truncate">{nextBlock.title}</h2>
                <p className="t-num mt-1 text-[0.9375rem] text-ink-muted">{formatTime(nextBlock.start)} – {formatTime(nextBlock.end)}</p>
                <div className="mt-5">
                  <Button variant="secondary" iconLeft={<Play className="h-4 w-4 fill-current" />} onClick={async () => { await startBlock(nextBlock.id); toast.success('Started early'); }}>
                    Start early
                  </Button>
                </div>
              </>
            ) : nextTask ? (
              <>
                <div className="text-[0.8125rem] font-semibold text-ink-muted">Next task</div>
                <h2 className="t-title1 mt-2 truncate">{nextTask.title}</h2>
                <p className="mt-1 text-[0.9375rem] text-ink-muted">Not scheduled · {formatDuration(nextTask.estimatedMinutes)} estimated</p>
                <div className="mt-5"><Link to="/tasks"><Button variant="primary">Schedule it</Button></Link></div>
              </>
            ) : (
              <>
                <div className="text-[0.8125rem] font-semibold text-ink-muted">Clear</div>
                <h2 className="t-title1 mt-2">Nothing scheduled right now</h2>
                <p className="mt-1 text-[0.9375rem] text-ink-muted">Plan the rest of the day or pick something from Tasks.</p>
                <div className="mt-5"><Link to="/schedule"><Button variant="secondary" iconLeft={<CalendarDays className="h-4 w-4" />}>Open schedule</Button></Link></div>
              </>
            )}
          </div>

          <div className="flex items-center gap-6">
            <ActivityRings rings={rings} />
            <RingLegend rings={rings} />
          </div>
        </div>

        <div className="border-t border-line-faint px-6 pb-5 pt-5 sm:px-7">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="t-section">Your day</h3>
            <span className="t-num text-[0.8125rem] text-ink-faint">
              {blocksDone} of {requiredToday.length} required done{profile?.currentStreak ? ` · ${profile.currentStreak}-day streak` : ''}
            </span>
          </div>
          <DayRibbon blocks={blocks} trackers={trackers} now={now} />
        </div>
      </section>

      <div className="mb-8 empty:hidden">
        <WorkGrowthCard />
      </div>

      {/* Dashboard */}
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="t-title3">Dashboard</h2>
          <p className="t-meta mt-0.5">{editing ? 'Drag or use the arrows to arrange. Hidden widgets stay here, dimmed.' : 'Live from your schedule, tasks, goals and history.'}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {editing ? <Button size="sm" variant="secondary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => setPickerOpen(true)}>Add</Button> : null}
          <Button size="sm" variant={editing ? 'primary' : 'ghost'} iconLeft={editing ? undefined : <LayoutGrid className="h-3.5 w-3.5" />} onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Customize'}
          </Button>
        </div>
      </div>
      {shownWidgets.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-7 w-7" />}
          title="Your dashboard is empty"
          description="Add the widgets you want to see every day."
          action={<Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setPickerOpen(true)}>Add widgets</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shownWidgets.map((widget) => {
            const def = WIDGET_REGISTRY[widget.type];
            if (!def) return null;
            const Component = def.component;
            return (
              <WidgetSlot
                key={widget.id}
                label={def.label}
                editing={editing}
                hidden={widget.hidden}
                dragging={draggedId === widget.id}
                isOver={overId === widget.id}
                sizeClass={sizeClassFor(widget.size)}
                onRemove={() => void setDashboardLayout(removeWidget(layout, widget.id))}
                onHide={(h) => void setDashboardLayout(setWidgetHidden(layout, widget.id, h))}
                onResize={() => void setDashboardLayout(cycleWidgetSize(layout, widget.id))}
                onMove={(d) => void setDashboardLayout(moveWidget(layout, widget.id, d))}
                onDragStart={() => setDraggedId(widget.id)}
                onDragEnd={() => { setDraggedId(null); setOverId(null); }}
                onDragOver={() => setOverId(widget.id)}
                onDrop={() => handleDrop(widget.id)}
              >
                <WidgetBoundary title={def.label}>
                  <Component config={widget} />
                </WidgetBoundary>
              </WidgetSlot>
            );
          })}
        </div>
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
  if (size === 'large') return 'sm:col-span-2 xl:col-span-4';
  if (size === 'medium') return 'sm:col-span-2 xl:col-span-2';
  return 'col-span-1';
}

function greetingFor(hour: number, name?: string): string {
  const part = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Good night';
  return name ? `${part}, ${name}` : part;
}
