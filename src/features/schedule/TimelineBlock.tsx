import { Check, Coffee, Lock, Moon, Repeat, Shield, Utensils } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMinute } from '@/lib/date';
import { KIND_LABELS, blockPalette, statusDecoration } from './blockStyles';
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
  const immovable = block.locked;
  const style = kindStyle(block.kind);
  const h = Math.max(16, height);
  // Adaptive density: never force more text than the block can carry.
  const tier = h < 24 ? 0 : h < 42 ? 1 : h < 72 ? 2 : 3;
  const range = `${formatMinute(minuteOf(block.start))} – ${formatMinute(minuteOf(block.end))}`;
  const done = block.status === 'completed';
  const live = block.status === 'in_progress';
  const KindIcon = style === 'night' ? Moon : block.kind === 'meal' ? Utensils : style === 'air' ? Coffee : null;

  const fill =
    style === 'solid' ? `${p.hex}${done ? '4d' : live ? '40' : '26'}`
    : style === 'night' ? 'rgb(var(--c-ink) / 0.035)'
    : 'transparent';
  const edge =
    style === 'solid' ? `inset 3px 0 0 ${p.hex}`
    : style === 'air' ? `inset 0 0 0 1px ${p.hex}55`
    : 'inset 0 0 0 1px rgb(var(--c-ink) / 0.06)';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${block.title}, ${KIND_LABELS[block.kind]}, ${range}${done ? ', completed' : live ? ', in progress' : ''}${block.protected ? ', protected' : ''}`}
      aria-pressed={selected}
      onPointerDown={(e) => { if (!immovable) onPointerDown(e, 'move'); }}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{
        top, height: h,
        left: `calc(${left * 100}% + 2px)`,
        width: `calc(${width * 100}% - 4px)`,
        backgroundColor: fill,
        boxShadow: selected ? `${edge}, 0 0 0 2px rgb(var(--c-accent)), 0 8px 24px -10px rgb(0 0 0 / 0.7)` : edge,
        ...(style === 'air' ? { backgroundImage: 'none', border: `1px dashed ${p.hex}66`, boxShadow: selected ? '0 0 0 2px rgb(var(--c-accent))' : 'none' } : {}),
      }}
      className={cn(
        'group absolute select-none overflow-hidden rounded-[7px] text-left transition-[transform,filter,box-shadow] duration-fast',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        tier === 0 ? 'px-1.5' : 'py-1 pl-2 pr-1.5',
        style === 'solid' ? 'text-ink hover:brightness-[1.15]' : 'text-ink-muted hover:text-ink',
        style === 'night' && 'block-night',
        block.protected && 'block-protected',
        statusDecoration(block.status),
        immovable ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing active:scale-[0.99]',
        selected && 'z-20',
      )}
    >
      <div className={cn('flex min-w-0 gap-1', tier <= 1 ? 'h-full items-center' : 'items-start')}>
        {live ? <span className="live-dot mt-[1px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: p.hex }} aria-hidden /> : null}
        {KindIcon && tier >= 1 ? <KindIcon className="h-3 w-3 shrink-0 opacity-70" aria-hidden /> : null}
        <span className={cn('min-w-0 flex-1 truncate leading-tight',
          style === 'solid' ? 'font-semibold' : 'font-medium',
          tier === 0 || dense ? 'text-[0.6875rem]' : 'text-[0.75rem]')}>
          {block.title}
        </span>
        {tier === 1 && !dense ? <span className="t-num shrink-0 text-[0.6875rem] opacity-60">{formatMinute(minuteOf(block.start))}</span> : null}
        <span className="flex shrink-0 items-center gap-0.5 opacity-70">
          {done ? <Check className="h-3 w-3" strokeWidth={3} style={{ color: p.hex }} aria-hidden /> : null}
          {tier >= 1 && block.locked ? <Lock className="h-2.5 w-2.5" aria-hidden /> : null}
          {tier >= 1 && block.protected ? <Shield className="h-2.5 w-2.5" aria-hidden /> : null}
          {tier >= 2 && block.recurringRuleId ? <Repeat className="h-2.5 w-2.5" aria-hidden /> : null}
        </span>
      </div>
      {tier >= 2 ? (
        <div className="t-num mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.6875rem] opacity-65">
          <span className="truncate">{range}</span>
          {tracker && !dense ? <span className="hidden truncate sm:inline">· {tracker.name}</span> : null}
        </div>
      ) : null}
      {tier >= 3 && block.notes && !dense ? (
        <div className="mt-1 line-clamp-2 text-[0.6875rem] leading-snug opacity-55">{block.notes}</div>
      ) : null}

      {resizable && !immovable ? (
        <>
          <div role="separator" aria-label="Resize start" onPointerDown={(e) => onPointerDown(e, 'resize-start')}
            className="absolute inset-x-1 top-0 h-2 cursor-ns-resize after:absolute after:left-1/2 after:top-[3px] after:h-[3px] after:w-6 after:-translate-x-1/2 after:rounded-full after:bg-ink/40 after:opacity-0 after:transition-opacity group-hover:after:opacity-100" />
          <div role="separator" aria-label="Resize end" onPointerDown={(e) => onPointerDown(e, 'resize-end')}
            className="absolute inset-x-1 bottom-0 h-2 cursor-ns-resize after:absolute after:bottom-[3px] after:left-1/2 after:h-[3px] after:w-6 after:-translate-x-1/2 after:rounded-full after:bg-ink/40 after:opacity-0 after:transition-opacity group-hover:after:opacity-100" />
        </>
      ) : null}
      <span className="sr-only">{startMinute}</span>
    </div>
  );
}

type KindStyle = 'solid' | 'air' | 'night';
/** Visual grammar per block kind: work is solid, pauses are air, sleep is night. */
function kindStyle(kind: ScheduleBlock['kind']): KindStyle {
  if (kind === 'sleep') return 'night';
  if (kind === 'break' || kind === 'buffer' || kind === 'meal') return 'air';
  return 'solid';
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
      className="pointer-events-none absolute z-30 flex items-start rounded-[7px] border border-accent/70 bg-accent/15 px-2 py-1 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.8)]"
    >
      <span className="t-num truncate rounded-[5px] bg-accent px-1.5 py-0.5 text-[0.6875rem] font-semibold text-accent-contrast">{label}</span>
    </div>
  );
}
