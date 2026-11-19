import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useCompleteBlockStore } from '@/state/completeBlockStore';

/**
 * The "what did you work on?" sheet behind every block Done button (see
 * completeBlockStore). Mounted once in the app shell.
 */
export function CompleteBlockSheet() {
  const { block, subjects, unitLabel, close, confirm } = useCompleteBlockStore();
  const [trackerId, setTrackerId] = useState<string | undefined>(undefined);
  const [units, setUnits] = useState(0);

  useEffect(() => {
    setTrackerId(undefined);
    setUnits(block?.units ?? 0);
  }, [block]);

  if (!block) return null;
  return (
    <Modal
      open
      onClose={close}
      title={`Complete “${block.title}”`}
      description={subjects.length ? 'Pick what you actually worked on so it counts toward that subject.' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => void confirm({ trackerId, units: unitLabel ? units : undefined })}>
            Mark done
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {subjects.length ? (
          <div>
            <div className="t-label mb-2">Subject</div>
            <div className="flex flex-wrap gap-2">
              {[{ id: undefined as string | undefined, name: 'General' }, ...subjects].map((s) => (
                <button
                  key={s.id ?? 'general'}
                  type="button"
                  onClick={() => setTrackerId(s.id)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    trackerId === s.id
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {unitLabel ? (
          <div>
            <div className="t-label mb-2 capitalize">{unitLabel} done</div>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="secondary" aria-label="One less" onClick={() => setUnits((n) => Math.max(0, n - 1))}>
                <Minus className="h-4 w-4" />
              </Button>
              <input
                inputMode="numeric"
                className="w-20 rounded-[var(--r-lg)] bg-surface-sunken px-3 py-2 text-center text-lg font-semibold text-ink t-num focus:outline-none focus:ring-2 focus:ring-accent/60"
                value={units}
                onChange={(e) => setUnits(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))}
              />
              <Button size="sm" variant="secondary" aria-label="One more" onClick={() => setUnits((n) => n + 1)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
