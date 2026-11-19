import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';
import { atMinute, formatDuration, formatMinute, MINUTE_MS } from '@/lib/date';
import { layoutDayBlocks } from '@/services/scheduleService';
import { TimelineBlock, DragGhost } from './TimelineBlock';
import { useTimelineDrag, type DragMode } from './useTimelineDrag';
import type { DateKey, ID, ScheduleBlock, Tracker } from '@/types';

/**
 * The shared time grid. One instance renders N day columns, so the day view is
 * simply the week view with a single column — no duplicated geometry code.
 */

export interface TimelineGridProps {
  dates: DateKey[];
  blocks: ScheduleBlock[];
  trackerMap: Record<ID, Tracker>;
  /** First and last rendered minute-of-day. */
  fromMinute: number;
  toMinute: number;
  /** Vertical scale. 1 px/min = a 24h day is 1440px tall. */
  pixelsPerMinute: number;
  snapMinutes: number;
  selectedId: ID | null;
  now: number;
  onSelect: (block: ScheduleBlock) => void;
  onMoved: (block: ScheduleBlock, start: number, end: number) => void | Promise<void>;
  /** Click on empty grid space -> create a block at that time. */
  onCreateAt: (date: DateKey, startMinute: number) => void;
  dense?: boolean;
  className?: string;
}

const HOUR_LABEL_WIDTH = 64;

export function TimelineGrid({
  dates, blocks, trackerMap, fromMinute, toMinute, pixelsPerMinute, snapMinutes,
  selectedId, now, onSelect, onMoved, onCreateAt, dense, className,
}: TimelineGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const totalMinutes = Math.max(60, toMinute - fromMinute);
  const height = totalMinutes * pixelsPerMinute;
  const columnCount = dates.length;

  // Layout per column, computed once per block/date change.
  const columns = useMemo(
    () => dates.map((date) => {
      const dayStart = atMinute(date, 0);
      const dayBlocks = blocks.filter((b) => b.date === date);
      return { date, dayStart, laid: layoutDayBlocks(dayBlocks, dayStart) };
    }),
    [dates, blocks],
  );

  const blockById = useMemo(() => {
    const map: Record<ID, { block: ScheduleBlock; columnIndex: number }> = {};
    columns.forEach((col, ci) => {
      for (const l of col.laid) map[l.block.id] = { block: l.block, columnIndex: ci };
    });
    return map;
  }, [columns]);

  /** Earliest block start in the range, used to pick a sensible initial scroll. */
  const firstBlockMinute = useMemo(() => {
    let min: number | null = null;
    for (const col of columns) {
      for (const l of col.laid) min = min === null ? l.startMinute : Math.min(min, l.startMinute);
    }
    return min;
  }, [columns]);

  const columnWidthPx = useCallback(() => {
    const el = bodyRef.current;
    if (!el || columnCount < 2) return 0;
    return (el.clientWidth - HOUR_LABEL_WIDTH) / columnCount;
  }, [columnCount]);

  const { drag, begin, justDragged } = useTimelineDrag({
    pixelsPerMinute,
    snapMinutes,
    minMinutes: 5,
    originMinute: fromMinute,
    endMinute: toMinute,
    getColumnWidth: columnWidthPx,
    columnCount,
    onCommit: async ({ id, startMinute, endMinute, columnIndex }) => {
      const entry = blockById[id];
      if (!entry) return;
      const targetDate = dates[columnIndex] ?? entry.block.date;
      const start = atMinute(targetDate, startMinute);
      const endTs = atMinute(targetDate, endMinute);
      await onMoved(entry.block, start, endTs);
    },
  });

  const hourLines = useMemo(() => {
    const out: number[] = [];
    for (let m = Math.ceil(fromMinute / 60) * 60; m <= toMinute; m += 60) out.push(m);
    return out;
  }, [fromMinute, toMinute]);

  const nowDate = new Date(now);
  const nowMinute = nowDate.getHours() * 60 + nowDate.getMinutes();
  const nowKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  const nowColumn = dates.indexOf(nowKey);
  const nowVisible = nowColumn >= 0 && nowMinute >= fromMinute && nowMinute <= toMinute;

  const yFor = (minute: number) => (minute - fromMinute) * pixelsPerMinute;

  // Scroll the current hour into view once, so the grid opens on "now" rather
  // than on an empty early morning. Re-runs when the rendered range changes.
  const scrolledFor = useRef('');
  useEffect(() => {
    const el = scrollRef.current;
    const key = `${dates[0]}|${dates.length}|${fromMinute}|${pixelsPerMinute}`;
    if (!el || scrolledFor.current === key) return;
    scrolledFor.current = key;
    const target = nowVisible ? nowMinute : firstBlockMinute ?? 8 * 60;
    el.scrollTop = Math.max(0, (target - fromMinute) * pixelsPerMinute - el.clientHeight / 3);
  }, [dates, fromMinute, pixelsPerMinute, nowVisible, nowMinute, firstBlockMinute]);

  const handleGridClick = (e: React.MouseEvent, date: DateKey) => {
    if (drag || justDragged()) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const minute = fromMinute + (e.clientY - rect.top) / pixelsPerMinute;
    const snapped = Math.round(minute / snapMinutes) * snapMinutes;
    onCreateAt(date, Math.max(fromMinute, Math.min(toMinute - 15, snapped)));
  };

  return (
    <div ref={scrollRef} className={cn('relative overflow-auto overscroll-contain rounded-[14px] surface-card', className)}>
      <div ref={bodyRef} className="relative flex" style={{ height }}>
        {/* Hour gutter */}
        <div className="sticky left-0 z-10 shrink-0 border-r border-line-faint bg-surface-raised" style={{ width: HOUR_LABEL_WIDTH }}>
          {hourLines.map((m) => {
            const current = nowVisible && Math.floor(nowMinute / 60) * 60 === m;
            return (
              <div
                key={m}
                className="absolute -translate-y-1/2 whitespace-nowrap pr-2.5 text-right"
                style={{ top: yFor(m), width: HOUR_LABEL_WIDTH }}
              >
                <span className={cn('t-num text-[0.6875rem]', current ? 'font-semibold text-ink' : 'text-ink-faint')}>{formatMinute(m)}</span>
              </div>
            );
          })}
          {nowVisible ? (
            <div className="absolute right-1 z-10 -translate-y-1/2" style={{ top: yFor(nowMinute) }}>
              <span className="t-num rounded-[5px] bg-[#D70015] px-1 py-[1px] text-[0.625rem] font-bold text-white">{formatMinute(nowMinute)}</span>
            </div>
          ) : null}
        </div>

        {/* Day columns */}
        <div className="relative flex flex-1">
          {/* Hour lines span all columns */}
          <div className="pointer-events-none absolute inset-0">
            {hourLines.map((m) => (
              <div key={m} className="absolute inset-x-0 border-t border-line-faint" style={{ top: yFor(m) }} />
            ))}
            {/* Half-hour hairlines, only when the grid is tall enough to read them */}
            {pixelsPerMinute >= 0.7 &&
              hourLines.map((m) => (
                <div
                  key={`h${m}`}
                  className="absolute inset-x-0 border-t border-dashed border-line-faint/60"
                  style={{ top: yFor(m + 30) }}
                />
              ))}
          </div>

          {columns.map((col, ci) => (
            <div
              key={col.date}
              className={cn('relative flex-1 border-l border-line-faint', ci === 0 && 'border-l-0')}
              onClick={(e) => { if (e.target === e.currentTarget) handleGridClick(e, col.date); }}
            >
              {/* Elapsed time today reads as slightly receded. */}
              {nowVisible && nowColumn === ci ? (
                <div className="timeline-past pointer-events-none absolute inset-x-0 top-0" style={{ height: yFor(nowMinute) }} aria-hidden />
              ) : null}
              {col.laid.map(({ block, left, width, startMinute, endMinute }) => {
                const isDragging = drag?.active && drag.id === block.id;
                if (isDragging) return null;
                return (
                  <TimelineBlock
                    key={block.id}
                    block={block}
                    tracker={trackerMap[block.trackerId]}
                    top={yFor(startMinute)}
                    height={(endMinute - startMinute) * pixelsPerMinute}
                    left={left}
                    width={width}
                    dense={dense}
                    selected={selectedId === block.id}
                    resizable={pixelsPerMinute >= 0.5}
                    onOpen={() => { if (!justDragged()) onSelect(block); }}
                    onPointerDown={(e: React.PointerEvent, mode: DragMode) =>
                      begin(e, { id: block.id, mode, startMinute, endMinute, columnIndex: ci })
                    }
                  />
                );
              })}

              {drag?.active && drag.columnIndex === ci ? (
                <DragGhost
                  top={yFor(drag.startMinute)}
                  height={(drag.endMinute - drag.startMinute) * pixelsPerMinute}
                  left={0}
                  width={1}
                  label={`${formatMinute(drag.startMinute)} – ${formatMinute(drag.endMinute)} · ${formatDuration(drag.endMinute - drag.startMinute)}`}
                />
              ) : null}

              {nowVisible && nowColumn === ci ? (
                <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: yFor(nowMinute) }}>
                  <div className="relative h-[2px] bg-critical shadow-[0_0_10px_rgb(var(--c-critical)/0.6)]">
                    <span className="absolute -left-[5px] -top-[4px] h-2.5 w-2.5 rounded-full bg-critical ring-2 ring-surface-raised" />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Converts a minute-of-day on a date to an absolute timestamp. */
export function minuteToTimestamp(date: DateKey, minute: number): number {
  return atMinute(date, minute);
}

export { MINUTE_MS };
