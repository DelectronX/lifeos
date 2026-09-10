import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { addDaysToKey, formatDateKeyShort, todayKey } from '@/lib/date';
import { toast } from '@/state/toastStore';
import { postponeRevision, rescheduleRevision, skipRevision, type RevisionCard } from '@/services/revisionService';

const QUICK_SHIFTS = [1, 2, 3, 7];

export function RescheduleRevisionDialog({
  card, onClose,
}: {
  card: RevisionCard;
  onClose: () => void;
}) {
  const [date, setDate] = useState(card.entry.dueDate);
  const [saving, setSaving] = useState(false);

  const apply = async (fn: () => Promise<{ explanation: string } | null>) => {
    setSaving(true);
    try {
      const result = await fn();
      if (result) toast.success('Revision moved', result.explanation);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reschedule: ${card.plan.title}`}
      description={`Currently due ${formatDateKeyShort(card.entry.dueDate)} — ${card.label.toLowerCase()}.`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!date || date === card.entry.dueDate}
            onClick={() => void apply(() => rescheduleRevision(card.entry.id, date))}
          >
            Move to {date || '…'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="t-label mb-2">Push it back</div>
          <div className="flex flex-wrap gap-2">
            {QUICK_SHIFTS.map((days) => (
              <Button
                key={days}
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => void apply(() => postponeRevision(card.entry.id, days))}
              >
                +{days} day{days === 1 ? '' : 's'}
                <span className="t-meta ml-1">{formatDateKeyShort(addDaysToKey(card.entry.dueDate, days))}</span>
              </Button>
            ))}
          </div>
          <p className="t-meta mt-1.5">
            Later repetitions keep their own spacing, so only this one moves.
          </p>
        </div>

        <Field label="Or pick an exact date" hint="Moving a revision changes its interval from the previous repetition.">
          <Input type="date" value={date} min={todayKey()} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <div className="border-t border-line pt-3">
          <Button
            size="sm"
            variant="ghost"
            className="text-critical"
            disabled={saving}
            onClick={() => void apply(async () => {
              await skipRevision(card.entry.id, 'Skipped from the revision dashboard');
              return { explanation: 'Marked as skipped. It stays in your history but will not come back.' };
            })}
          >
            Skip this repetition
          </Button>
        </div>
      </div>
    </Modal>
  );
}
