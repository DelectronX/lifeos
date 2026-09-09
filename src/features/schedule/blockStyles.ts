import { TRACKER_PALETTE } from '@/config/trackers';
import type { BlockKind, BlockStatus, ScheduleBlock, Tracker, TrackerColor } from '@/types';

/**
 * Block colour resolution.
 *
 * A block takes its colour from its tracker (Study/Fitness/Skills/Personal and
 * the system trackers Sleep/School/Meals/Break/Free), falling back to a per-kind
 * default when a tracker is missing. The palette itself lives in one place
 * (config/trackers.ts) so schedule, analytics and badges never drift apart.
 */

const KIND_FALLBACK: Record<BlockKind, TrackerColor> = {
  task: 'indigo',
  fixed: 'sky',
  break: 'lime',
  buffer: 'stone',
  sleep: 'slate',
  meal: 'stone',
  event: 'stone',
};

export function blockColor(block: ScheduleBlock, tracker?: Tracker): TrackerColor {
  return tracker?.color ?? KIND_FALLBACK[block.kind] ?? 'slate';
}

export function blockPalette(block: ScheduleBlock, tracker?: Tracker) {
  return TRACKER_PALETTE[blockColor(block, tracker)] ?? TRACKER_PALETTE.slate;
}

export const KIND_LABELS: Record<BlockKind, string> = {
  task: 'Task',
  fixed: 'Fixed',
  break: 'Break',
  buffer: 'Buffer',
  sleep: 'Sleep',
  meal: 'Meal',
  event: 'Event',
};

export const BLOCK_STATUS_LABELS: Record<BlockStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  partial: 'Partial',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

/** Visual treatment applied on top of the tracker colour, by status. */
export function statusDecoration(status: BlockStatus): string {
  switch (status) {
    case 'completed': return 'opacity-70';
    case 'skipped': return 'opacity-45 line-through decoration-1';
    case 'cancelled': return 'opacity-35 line-through decoration-1';
    case 'in_progress': return 'ring-1 ring-accent/50';
    default: return '';
  }
}
