import { CalendarX2, CheckCircle2, MoreHorizontal, SkipForward } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, EmptyState } from '@/components/ui/Card';
import { Badge, Dot } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { Menu, type MenuItemSpec } from '@/components/ui/Menu';
import {
  completeBlock, duplicateBlock, deleteBlock, reopenBlock, skipBlock, startBlock,
} from '@/services/scheduleService';
import { toast } from '@/state/toastStore';
import { formatDateKeyLong, formatDuration, formatTimeRange, relativeDayLabel } from '@/lib/date';
import { BLOCK_STATUS_LABELS, blockPalette } from './blockStyles';
import type { DateKey, ID, ScheduleBlock, Tracker } from '@/types';

/**
 * Agenda / list view. The primary schedule surface on mobile, where a 1440px
 * tall time grid is unusable — it is a real alternative layout, not a squeeze.
 */
export function AgendaView({
  dates, blocks, trackerMap, selectedId, onSelect, now,
}: {
  dates: DateKey[];
  blocks: ScheduleBlock[];
  trackerMap: Record<ID, Tracker>;
  selectedId: ID | null;
  onSelect: (block: ScheduleBlock) => void;
  now: number;
}) {
  const byDate = new Map<DateKey, ScheduleBlock[]>();
  for (const date of dates) byDate.set(date, []);
  for (const b of blocks) byDate.get(b.date)?.push(b);
  for (const list of byDate.values()) list.sort((a, b) => a.start - b.start);

  const anyBlocks = blocks.length > 0;
  if (!anyBlocks) {
    return (
      <EmptyState
        icon={<CalendarX2 className="h-8 w-8" />}
        title="Nothing scheduled"
        description="Click an empty slot in the day or week view to add a block, or apply a schedule template."
      />
    );
  }

  return (
    <div className="space-y-6">
      {dates.map((date) => {
        const list = byDate.get(date) ?? [];
        if (!list.length) return null;
        const total = list
          .filter((b) => b.status !== 'cancelled' && b.status !== 'skipped')
          .reduce((s, b) => s + (b.end - b.start) / 60_000, 0);
        return (
          <section key={date}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="t-section">
                {relativeDayLabel(date)}
                <span className="t-meta ml-2 font-normal">{formatDateKeyLong(date)}</span>
              </h2>
              <span className="t-meta t-num">{formatDuration(total)}</span>
            </div>
            <Card padded={false} className="overflow-hidden">
              {list.map((block) => (
                <AgendaRow
                  key={block.id}
                  block={block}
                  tracker={trackerMap[block.trackerId]}
                  selected={selectedId === block.id}
                  onSelect={() => onSelect(block)}
                  now={now}
                />
              ))}
            </Card>
          </section>
        );
      })}
    </div>
  );
}

function AgendaRow({
  block, tracker, selected, onSelect, now,
}: {
  block: ScheduleBlock;
  tracker?: Tracker;
  selected: boolean;
  onSelect: () => void;
  now: number;
}) {
  const p = blockPalette(block, tracker);
  const closed = block.status === 'completed' || block.status === 'skipped' || block.status === 'cancelled';
  const current = block.start <= now && block.end > now && !closed;

  const items: MenuItemSpec[] = [
    { label: 'Open inspector', onSelect },
    ...(closed
      ? [{ label: 'Reopen', onSelect: async () => { await reopenBlock(block.id); toast.success('Reopened'); } }]
      : [
          { label: 'Complete', onSelect: async () => { await completeBlock(block.id); toast.success('Completed'); } },
          { label: 'Skip', onSelect: async () => { await skipBlock(block.id); toast.success('Skipped'); } },
          { label: 'Start now', onSelect: async () => { await startBlock(block.id); toast.success('Started'); } },
        ]),
    { label: 'Duplicate', separated: true, onSelect: async () => { await duplicateBlock(block.id); toast.success('Duplicated'); } },
    { label: 'Delete', danger: true, onSelect: async () => { await deleteBlock(block.id); toast.success('Deleted'); } },
  ];

  return (
    <div
      className={cn(
        'flex items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0',
        selected ? 'bg-accent-soft/60' : 'hover:bg-surface-sunken',
        closed && 'opacity-60',
        current && 'border-l-2 border-l-critical',
      )}
    >
      <div className="w-[5.5rem] shrink-0 pt-0.5">
        <div className="t-num text-xs font-medium text-ink">{formatTimeRange(block.start, block.end)}</div>
        <div className="t-meta t-num">{formatDuration((block.end - block.start) / 60_000)}</div>
      </div>

      <span className={cn('mt-1 h-8 w-1 shrink-0 rounded-full', p.bar)} />

      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <div className={cn('truncate text-sm text-ink', closed && 'line-through decoration-1')}>{block.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {tracker ? (
            <span className="inline-flex items-center gap-1.5 text-2xs text-ink-muted">
              <Dot color={tracker.color} />{tracker.name}
            </span>
          ) : null}
          <Badge tone={block.status === 'completed' ? 'positive' : current ? 'accent' : 'neutral'}>
            {current ? 'Now' : BLOCK_STATUS_LABELS[block.status]}
          </Badge>
          {block.locked ? <span className="t-meta">Locked</span> : null}
          {block.protected ? <span className="t-meta">Protected</span> : null}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        {!closed ? (
          <>
            <IconButton
              label="Complete block"
              size="xs"
              onClick={async () => { await completeBlock(block.id); toast.success('Completed'); }}
            >
              <CheckCircle2 className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Skip block"
              size="xs"
              onClick={async () => { await skipBlock(block.id); toast.success('Skipped'); }}
            >
              <SkipForward className="h-4 w-4" />
            </IconButton>
          </>
        ) : null}
        <Menu
          items={items}
          trigger={({ toggle, ref }) => (
            <IconButton ref={ref as React.Ref<HTMLButtonElement>} label="Block actions" size="xs" onClick={toggle}>
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          )}
        />
      </div>
    </div>
  );
}
