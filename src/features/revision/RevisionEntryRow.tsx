import { useState } from 'react';
import { CalendarClock, Check, ChevronDown, ListPlus, Undo2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, Dot } from '@/components/ui/Badge';
import { formatDateKeyShort, formatDuration, relativeDayLabel, toDateKey } from '@/lib/date';
import { useTrackerMap } from '@/state/useLiveData';
import type { RevisionCard } from '@/services/revisionService';

/**
 * One revision in the dashboard. Shows everything the spec asks for: topic,
 * subject, the date the material was originally learnt, which repetition this
 * is, when it is due, and the completion history of the plan it belongs to.
 */
export function RevisionEntryRow({
  card, completed, onComplete, onPostpone, onReschedule, onSchedule, onUndo,
}: {
  card: RevisionCard;
  completed?: boolean;
  onComplete: () => void;
  onPostpone: (days: number) => void | Promise<void>;
  onReschedule: () => void;
  onSchedule: () => void | Promise<void>;
  onUndo: () => void | Promise<void>;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const trackers = useTrackerMap();
  const tracker = trackers[card.entry.trackerId];
  const doneHistory = card.history;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {tracker ? <Dot color={tracker.color} /> : null}
            <span className="truncate text-sm font-medium text-ink">{card.plan.title}</span>
            <Badge tone="outline">
              Rep {card.revisionNumber} of {card.totalRepetitions}
            </Badge>
          </div>

          <div className="t-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{card.trackerName}</span>
            <span>Learnt {formatDateKeyShort(card.learnedOn)}</span>
            <span>
              {completed && card.entry.completedAt
                ? `Completed ${relativeDayLabel(toDateKey(card.entry.completedAt))}`
                : `Due ${formatDateKeyShort(card.entry.dueDate)}`}
            </span>
            <span>{formatDuration(card.durationMinutes)}</span>
            {card.entry.quality !== null ? <span>Recall {card.entry.quality}/5</span> : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={toneFor(card)}>{card.label}</Badge>
            {doneHistory.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-ink-muted transition-colors hover:text-ink"
              >
                {doneHistory.length} completed before
                <ChevronDown className={`h-3 w-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {completed ? (
            <Button size="sm" variant="ghost" iconLeft={<Undo2 className="h-3.5 w-3.5" />} onClick={() => void onUndo()}>
              Reopen
            </Button>
          ) : (
            <>
              <Button size="sm" variant="primary" iconLeft={<Check className="h-3.5 w-3.5" />} onClick={onComplete}>
                Complete
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void onPostpone(1)}>
                +1 day
              </Button>
              <Button size="sm" variant="ghost" iconLeft={<CalendarClock className="h-3.5 w-3.5" />} onClick={onReschedule}>
                Reschedule
              </Button>
              {!card.entry.taskId ? (
                <Button size="sm" variant="ghost" iconLeft={<ListPlus className="h-3.5 w-3.5" />} onClick={() => void onSchedule()}>
                  Add task
                </Button>
              ) : (
                <Badge tone="neutral">Task created</Badge>
              )}
            </>
          )}
        </div>
      </div>

      {showHistory && doneHistory.length > 0 ? (
        <div className="border-t border-line bg-surface-sunken/40 px-3.5 py-2.5">
          <div className="t-label mb-1.5">Completion history</div>
          <ul className="space-y-1">
            {doneHistory.map((h) => (
              <li key={`${h.repetition}-${h.dueDate}`} className="t-meta flex flex-wrap items-center gap-x-3">
                <span className="text-ink-muted">Rep {h.repetition + 1}</span>
                <span>due {formatDateKeyShort(h.dueDate)}</span>
                <span>
                  {h.completedAt ? `done ${formatDateKeyShort(toDateKey(h.completedAt))}` : 'not completed'}
                </span>
                {h.quality !== null ? <span>recall {h.quality}/5</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function toneFor(card: RevisionCard): 'critical' | 'caution' | 'accent' | 'positive' | 'neutral' {
  switch (card.bucket) {
    case 'overdue': return 'critical';
    case 'missed': return 'caution';
    case 'due_today': return 'accent';
    case 'done': return 'positive';
    default: return 'neutral';
  }
}
