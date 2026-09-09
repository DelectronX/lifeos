import { Lock, Repeat, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMinute } from '@/lib/date';
import { blockPalette, statusDecoration } from './blockStyles';
import type { ScheduleBlock, Tracker } from '@/types';
import type { DragMode } from './useTimelineDrag';

/**
 * One positioned block in a timeline column. Purely presentational: it reports
 * pointer intent upward and renders geometry it is told to render, so the same
 * component serves day and week views.
 */
export function TimelineBlock({
  block, tracker, top, height, left, width, selected, resizable, onPointerDown, onOpen, dense,
}: {
  block: ScheduleBlock;
  tracker?: Tracker;
  /** CSS px offsets within the column. */
  top: number;
  height: number;
  /** Fractions 0..1 of the column width. */
  left: number;
  width: number;
  selected?: boolean;
  resizable?: boolean;
  onPointerDown: (e: React.PointerEvent, mode: DragMode) => void;
  onOpen: () => void;
  dense?: boolean;
}) {
  const p = blockPalette(block, tracker);
  const startMinute = Math.round(block.start % 86_400_000 / 60_000);
  const tiny = height < 34;
  const immovable = block.locked;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${block.title}, ${formatMinute(minuteOf(block.start))} to ${formatMinute(minuteOf(block.end))}`}
      onPointerDown={(e) => { if (!immovable) onPointerDown(e, 'move'); }}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{
        top,
        height: Math.max(16, height),
        left: `calc(${left * 100}% + 2px)`,
        width: `calc(${width * 100}% - 4px)`,
      }}
      className={cn(
        'absolute select-none overflow-hidden rounded-md border px-1.5 py-0.5 text-left shadow-sm',
        'transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        p.block,
        statusDecoration(block.status),
        immovable ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        selected && 'ring-2 ring-accent shadow-pop z-20',
        block.protected && 'border-dashed',
      )}
    >
      <div className={cn('flex items-start gap-1', tiny && 'items-center')}>
        <span className={cn('min-w-0 flex-1 truncate font-medium', tiny || dense ? 'text-2xs' : 'text-xs')}>
          {block.title}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 opacity-60">
          {block.locked ? <Lock className="h-2.5 w-2.5" /> : null}
          {block.protected ? <Shield className="h-2.5 w-2.5" /> : null}
          {block.recurringRuleId ? <Repeat className="h-2.5 w-2.5" /> : null}
        </span>
      </div>
      {!tiny ? (
        <div className="t-num truncate text-2xs opacity-70">
          {formatMinute(minuteOf(block.start))} – {formatMinute(minuteOf(block.end))}
        </div>
      ) : null}
      {height > 62 && block.notes ? (
        <div className="mt-0.5 line-clamp-2 text-2xs opacity-60">{block.notes}</div>
      ) : null}

      {resizable && !immovable ? (
        <>
          <div
            role="separator"
            aria-label="Resize start"
            onPointerDown={(e) => onPointerDown(e, 'resize-start')}
            className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize hover:bg-current/15"
          />
          <div
            role="separator"
            aria-label="Resize end"
            onPointerDown={(e) => onPointerDown(e, 'resize-end')}
            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize hover:bg-current/15"
          />
        </>
      ) : null}
      <span className="sr-only">{startMinute}</span>
    </div>
  );
}

function minuteOf(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/** Ghost preview drawn while a block is being dragged or resized. */
export function DragGhost({
  top, height, left, width, label,
}: {
  top: number;
  height: number;
  left: number;
  width: number;
  label: string;
}) {
  return (
    <div
      style={{
        top,
        height: Math.max(16, height),
        left: `calc(${left * 100}% + 2px)`,
        width: `calc(${width * 100}% - 4px)`,
      }}
      className="pointer-events-none absolute z-30 flex items-start rounded-md border-2 border-dashed border-accent bg-accent/10 px-1.5 py-0.5"
    >
      <span className="t-num truncate text-2xs font-medium text-accent-ink">{label}</span>
    </div>
  );
}
