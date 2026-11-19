import { create } from 'zustand';
import { db } from '@/db/db';
import { completeBlock } from '@/services/scheduleService';
import { toast } from './toastStore';
import type { ScheduleBlock, Tracker } from '@/types';

/**
 * One entry point for every "Done" button on a block.
 *
 * If the block's tracker has sub-trackers (e.g. Academics → Physics,
 * Chemistry…) or a unit label (e.g. LeetCode → "problems"), a small sheet asks
 * which subject / how many before completing. Otherwise the block completes
 * immediately. Both rules come from tracker DATA, never from block names.
 */
interface CompleteBlockState {
  block: ScheduleBlock | null;
  subjects: Tracker[];
  unitLabel: string | null;
  request: (block: ScheduleBlock) => Promise<void>;
  close: () => void;
  confirm: (opts: { trackerId?: string; units?: number }) => Promise<void>;
}

/** Non-archived descendants of a tracker, depth-first, leaves included. */
export function descendantsOf(rootId: string, trackers: readonly Tracker[]): Tracker[] {
  const out: Tracker[] = [];
  const walk = (id: string) => {
    for (const t of trackers.filter((x) => x.parentId === id && !x.archived).sort((a, b) => a.sortOrder - b.sortOrder)) {
      out.push(t);
      walk(t.id);
    }
  };
  walk(rootId);
  return out;
}

export const useCompleteBlockStore = create<CompleteBlockState>((set, get) => ({
  block: null,
  subjects: [],
  unitLabel: null,
  request: async (block) => {
    const trackers = await db.trackers.toArray();
    const planned = block.plannedTrackerId ?? block.trackerId;
    const subjects = descendantsOf(planned, trackers);
    let unitLabel: string | null = null;
    const byId = new Map(trackers.map((t) => [t.id, t]));
    for (let cur = byId.get(block.trackerId); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (cur.unitLabel) { unitLabel = cur.unitLabel; break; }
    }
    if (subjects.length === 0 && !unitLabel) {
      await runCompletion(block, {});
      return;
    }
    set({ block, subjects, unitLabel });
  },
  close: () => set({ block: null, subjects: [], unitLabel: null }),
  confirm: async ({ trackerId, units }) => {
    const block = get().block;
    if (!block) return;
    set({ block: null, subjects: [], unitLabel: null });
    await runCompletion(block, { trackerId, units });
  },
}));

/** Runs the single completion path and reports its real outcome. */
async function runCompletion(block: ScheduleBlock, opts: { trackerId?: string; units?: number }): Promise<void> {
  try {
    const r = await completeBlock(block.id, opts);
    if (r.status === 'completed') toast.success('Completed', block.title);
    else if (r.status === 'already_completed') toast.show('Already completed', block.title);
    else if (r.status === 'not_found') toast.error('Block no longer exists', 'It may have been deleted or regenerated.');
    else toast.error('Can’t complete this block', `It is ${r.blockStatus}.`);
  } catch (e) {
    console.error('[completeBlock] failed', e);
    toast.error('Couldn’t finish completing', e instanceof Error ? e.message : String(e));
  }
}

export function requestCompleteBlock(block: ScheduleBlock): Promise<void> {
  return useCompleteBlockStore.getState().request(block);
}
