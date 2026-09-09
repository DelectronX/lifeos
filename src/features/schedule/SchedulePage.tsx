import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, LayoutTemplate, ListOrdered, Plus, Repeat, ZoomIn, ZoomOut,
} from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { Dot } from '@/components/ui/Badge';
import { toast } from '@/state/toastStore';
import {
  useBlocksForRange, useLiveSettings, useNow, useSchedulingConfig, useTrackerMap,
} from '@/state/useLiveData';
import { minutesByTracker, setBlockTimes } from '@/services/scheduleService';
import {
  addDaysToKey, atMinute, formatDateKeyLong, formatDuration, relativeDayLabel,
  startOfWeekKey, todayKey, weekdayName, weekKeys,
} from '@/lib/date';
import { TimelineGrid } from './TimelineGrid';
import { AgendaView } from './AgendaView';
import { BlockInspector } from './BlockInspector';
import { BlockCreateModal } from './BlockCreateModal';
import { TemplateManager } from './TemplateManager';
import { RecurringRulesManager } from './RecurringRulesManager';
import { cn } from '@/lib/cn';
import type { DateKey, ID, ScheduleBlock } from '@/types';

type ViewMode = 'day' | 'week' | 'agenda';

const ZOOM_STEPS = [0.4, 0.6, 0.8, 1, 1.4, 2];

export function SchedulePage() {
  const settings = useLiveSettings();
  const config = useSchedulingConfig();
  const trackerMap = useTrackerMap();
  const now = useNow(30_000);

  const [view, setView] = useState<ViewMode>(() => (isNarrow() ? 'agenda' : 'day'));
  const [anchor, setAnchor] = useState<DateKey>(todayKey());
  const [zoomIndex, setZoomIndex] = useState(3);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [createSlot, setCreateSlot] = useState<{ date: DateKey; startMinute: number } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const weekStart = startOfWeekKey(anchor, settings?.weekStartsOn ?? 1);
  const dates = useMemo<DateKey[]>(
    () => (view === 'day' ? [anchor] : view === 'week' ? weekKeys(weekStart) : weekKeys(startOfWeekKey(anchor, settings?.weekStartsOn ?? 1))),
    [view, anchor, weekStart, settings?.weekStartsOn],
  );

  const rangeFrom = dates[0];
  const rangeTo = dates[dates.length - 1];
  const blocks = useBlocksForRange(rangeFrom, rangeTo);

  const selected = useMemo(() => blocks.find((b) => b.id === selectedId) ?? null, [blocks, selectedId]);

  // Visible vertical window: the working-hours band, widened to include any
  // block that falls outside it, so nothing is ever clipped off the grid.
  const [fromMinute, toMinute] = useMemo(() => {
    let from = 6 * 60;
    let to = 23 * 60;
    for (const b of blocks) {
      const s = new Date(b.start);
      const e = new Date(b.end);
      from = Math.min(from, Math.floor((s.getHours() * 60 + s.getMinutes()) / 60) * 60);
      const endMinute = e.getHours() * 60 + e.getMinutes() || 1440;
      to = Math.max(to, Math.ceil(endMinute / 60) * 60);
    }
    return [Math.max(0, from), Math.min(1440, Math.max(to, from + 120))] as [number, number];
  }, [blocks]);

  const pixelsPerMinute = ZOOM_STEPS[zoomIndex] * (view === 'week' ? 0.75 : 1);
  const snapMinutes = config.slots.granularityMinutes || 5;

  // Keep the selection valid when the range changes.
  useEffect(() => {
    if (selectedId && !blocks.some((b) => b.id === selectedId)) setSelectedId(null);
  }, [blocks, selectedId]);

  const step = useCallback(
    (direction: 1 | -1) => {
      setAnchor((d) => addDaysToKey(d, view === 'day' ? direction : direction * 7));
    },
    [view],
  );

  // Keyboard navigation across days/weeks; ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 't' || e.key === 'T') setAnchor(todayKey());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const trackerTotals = useMemo(() => {
    const totals = minutesByTracker(blocks);
    return Object.entries(totals)
      .map(([id, minutes]) => ({ tracker: trackerMap[id], minutes }))
      .filter((r) => r.tracker)
      .sort((a, b) => b.minutes - a.minutes);
  }, [blocks, trackerMap]);

  const handleMoved = async (block: ScheduleBlock, start: number, end: number) => {
    if (block.locked) { toast.warning('Block is locked', 'Unlock it in the inspector to move it.'); return; }
    await setBlockTimes(block.id, start, end);
  };

  const title = view === 'day'
    ? relativeDayLabel(anchor)
    : `${relativeDayLabel(dates[0])} – ${relativeDayLabel(dates[6])}`;

  return (
    <Page
      wide
      title="Schedule"
      subtitle={view === 'day' ? formatDateKeyLong(anchor) : `Week of ${formatDateKeyLong(dates[0])}`}
      actions={
        <>
          <Button size="sm" iconLeft={<LayoutTemplate className="h-3.5 w-3.5" />} onClick={() => setTemplatesOpen(true)}>
            Templates
          </Button>
          <Button size="sm" iconLeft={<Repeat className="h-3.5 w-3.5" />} onClick={() => setRulesOpen(true)}>
            Recurring
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            onClick={() => setCreateSlot({ date: view === 'day' ? anchor : todayKey(), startMinute: nowMinute() })}
          >
            New block
          </Button>
        </>
      }
      toolbar={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <IconButton label="Previous" size="sm" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></IconButton>
            <Button size="sm" onClick={() => setAnchor(todayKey())}>Today</Button>
            <IconButton label="Next" size="sm" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></IconButton>
            <span className="ml-2 text-sm font-medium text-ink">{title}</span>
          </div>

          <div className="flex items-center gap-2">
            {view !== 'agenda' ? (
              <div className="flex items-center gap-0.5">
                <IconButton label="Zoom out" size="sm" disabled={zoomIndex === 0} onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}>
                  <ZoomOut className="h-4 w-4" />
                </IconButton>
                <IconButton label="Zoom in" size="sm" disabled={zoomIndex === ZOOM_STEPS.length - 1} onClick={() => setZoomIndex((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}>
                  <ZoomIn className="h-4 w-4" />
                </IconButton>
              </div>
            ) : null}
            <Tabs
              variant="pill"
              size="sm"
              value={view}
              onChange={setView}
              items={[
                { value: 'day' as const, label: 'Day', icon: <CalendarDays className="h-3.5 w-3.5" /> },
                { value: 'week' as const, label: 'Week' },
                { value: 'agenda' as const, label: 'Agenda', icon: <ListOrdered className="h-3.5 w-3.5" /> },
              ]}
            />
          </div>
        </div>
      }
    >
      {trackerTotals.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-card border border-line bg-surface-raised px-3 py-2">
          {trackerTotals.map(({ tracker, minutes }) => (
            <span key={tracker!.id} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Dot color={tracker!.color} />
              {tracker!.name}
              <span className="t-num font-medium text-ink">{formatDuration(minutes)}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className={cn('grid gap-4', selected ? 'lg:grid-cols-[1fr_22rem]' : 'grid-cols-1')}>
        <div className="min-w-0">
          {view === 'agenda' ? (
            <AgendaView
              dates={dates}
              blocks={blocks}
              trackerMap={trackerMap}
              selectedId={selectedId}
              onSelect={(b) => setSelectedId(b.id)}
              now={now}
            />
          ) : (
            <>
              {view === 'week' ? (
                <div className="mb-1 flex" style={{ paddingLeft: 64 }}>
                  {dates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => { setAnchor(d); setView('day'); }}
                      className={cn(
                        'flex-1 rounded-md px-1 py-1.5 text-center transition-colors hover:bg-surface-sunken',
                        d === todayKey() && 'bg-accent-soft',
                      )}
                    >
                      <div className="t-label">{weekdayName(new Date(atMinute(d, 0)).getDay(), true)}</div>
                      <div className={cn('t-num text-sm font-medium', d === todayKey() ? 'text-accent-ink' : 'text-ink')}>
                        {Number(d.slice(-2))}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              <TimelineGrid
                dates={dates}
                blocks={blocks}
                trackerMap={trackerMap}
                fromMinute={fromMinute}
                toMinute={toMinute}
                pixelsPerMinute={pixelsPerMinute}
                snapMinutes={snapMinutes}
                selectedId={selectedId}
                now={now}
                dense={view === 'week'}
                onSelect={(b) => setSelectedId(b.id)}
                onMoved={handleMoved}
                onCreateAt={(date, startMinute) => setCreateSlot({ date, startMinute })}
                className="max-h-[min(70vh,calc(100vh-17rem))] min-h-[24rem]"
              />

              <p className="t-meta mt-2">
                Drag a block to move it, drag its top or bottom edge to resize, click empty space to add one.
                Snapping to {snapMinutes} minutes. Arrow keys change {view === 'day' ? 'day' : 'week'}; press T for today.
              </p>
            </>
          )}
        </div>

        {selected ? (
          <BlockInspector
            block={selected}
            onClose={() => setSelectedId(null)}
            onSelectBlock={setSelectedId}
            className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)]"
          />
        ) : null}
      </div>

      {blocks.length === 0 && view !== 'agenda' ? (
        <Card className="mt-4">
          <div className="t-section">Nothing scheduled here yet</div>
          <p className="t-muted mt-1">
            Click any empty slot on the grid to add a block, or apply a schedule template to stamp a
            repeating weekly shape across several days.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => setCreateSlot({ date: dates[0], startMinute: 9 * 60 })}>
              Add a block
            </Button>
            <Button size="sm" onClick={() => setTemplatesOpen(true)}>Open templates</Button>
          </div>
        </Card>
      ) : null}

      <BlockCreateModal
        open={!!createSlot}
        onClose={() => setCreateSlot(null)}
        date={createSlot?.date ?? anchor}
        startMinute={createSlot?.startMinute ?? 9 * 60}
        defaultMinutes={config.slots.defaultSessionMinutes}
        onCreated={(b) => setSelectedId(b.id)}
      />

      <TemplateManager open={templatesOpen} onClose={() => setTemplatesOpen(false)} currentDate={anchor} />
      <RecurringRulesManager open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </Page>
  );
}

function isNarrow(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

function nowMinute(): number {
  const d = new Date();
  return Math.min(23 * 60, Math.round((d.getHours() * 60 + d.getMinutes()) / 15) * 15);
}
