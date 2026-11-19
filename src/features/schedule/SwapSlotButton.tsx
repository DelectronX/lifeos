import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useBlocksForDay } from '@/state/useLiveData';
import { swapBlockSlots } from '@/services/scheduleService';
import { formatTime } from '@/lib/date';
import { toast } from '@/state/toastStore';
import type { ScheduleBlock } from '@/types';

/** "Swap slot (this day only)" — pick another block of the same day to trade times with. */
export function SwapSlotButton({ block }: { block: ScheduleBlock }) {
  const [open, setOpen] = useState(false);
  const blocks = useBlocksForDay(block.date);
  const candidates = blocks
    .filter((b) => b.id !== block.id && (b.status === 'planned' || b.status === 'in_progress') && !b.locked && b.kind !== 'sleep')
    .sort((a, b) => a.start - b.start);
  if (block.status !== 'planned' || block.locked) return null;

  return (
    <>
      <Button size="sm" iconLeft={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Swap slot
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Swap “${block.title}” with…`}
        description="Only this day changes. Your normal timetable stays the same on every other day."
      >
        {candidates.length === 0 ? (
          <p className="t-muted">No other open blocks on this day.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-line-faint overflow-y-auto rounded-xl surface-card">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-overlay"
                  onClick={async () => {
                    const res = await swapBlockSlots(block.id, c.id);
                    setOpen(false);
                    if (res.ok) toast.success('Swapped', res.message);
                    else toast.warning('Not swapped', res.message);
                  }}
                >
                  <span className="w-28 shrink-0 text-xs text-ink-muted t-num">{formatTime(c.start)}–{formatTime(c.end)}</span>
                  <span className="truncate text-sm text-ink">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
