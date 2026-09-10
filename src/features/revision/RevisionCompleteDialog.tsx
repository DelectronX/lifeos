import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useSchedulingConfig } from '@/state/useLiveData';
import type { RevisionCard } from '@/services/revisionService';

/**
 * SM-2 recall grading. The wording explains what each grade will DO to the
 * schedule, because the number only matters through its consequence.
 */
const GRADES: { value: number; label: string; help: string }[] = [
  { value: 0, label: 'Blank', help: 'No recall at all.' },
  { value: 1, label: 'Wrong', help: 'Recognised it, could not produce it.' },
  { value: 2, label: 'Shaky', help: 'Recalled with serious effort and errors.' },
  { value: 3, label: 'Correct', help: 'Recalled correctly but slowly.' },
  { value: 4, label: 'Solid', help: 'Recalled with a little hesitation.' },
  { value: 5, label: 'Instant', help: 'Immediate, effortless recall.' },
];

export function RevisionCompleteDialog({
  card, onClose, onConfirm,
}: {
  card: RevisionCard;
  onClose: () => void;
  onConfirm: (quality: number) => void | Promise<void>;
}) {
  const config = useSchedulingConfig();
  const [quality, setQuality] = useState(4);
  const [saving, setSaving] = useState(false);

  const lapses = quality < config.revision.lapseQualityThreshold;

  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm(quality);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Complete: ${card.plan.title}`}
      description={`Repetition ${card.revisionNumber} of ${card.totalRepetitions}, due ${card.entry.dueDate}. How well did you recall it?`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Mark complete
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {GRADES.map((g) => (
          <button
            key={g.value}
            type="button"
            onClick={() => setQuality(g.value)}
            className={cn(
              'rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ease-calm',
              quality === g.value
                ? 'border-accent bg-accent-soft text-accent-ink'
                : 'border-line bg-surface hover:border-line-strong',
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{g.label}</span>
              <span className="t-num text-2xs opacity-70">{g.value}</span>
            </div>
            <div className="t-meta mt-0.5">{g.help}</div>
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-line bg-surface-sunken/50 px-3 py-2.5">
        <div className="t-label mb-1">What happens next</div>
        <p className="t-muted">
          {lapses
            ? `A grade below ${config.revision.lapseQualityThreshold} counts as a lapse: the ladder steps back one repetition, the next interval is cut to ${Math.round(config.revision.lapsePenalty * 100)}% and this plan's ease drops. You will see it again sooner.`
            : `The ladder advances one step and the next repetition is re-dated from today using this plan's ease (currently ${card.plan.ease}).`}
        </p>
      </div>
    </Modal>
  );
}
