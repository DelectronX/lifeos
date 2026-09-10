import { cn } from '@/lib/cn';
import type { ID, Question, QuestionAttempt, QuestionStatus } from '@/types';

export const STATUS_LABELS: Record<QuestionStatus, string> = {
  unattempted: 'Not visited',
  correct: 'Correct',
  incorrect: 'Incorrect',
  skipped: 'Skipped',
  marked: 'Marked for review',
};

/** Restrained status colours — readable, never neon. */
export const STATUS_SWATCH: Record<QuestionStatus, string> = {
  unattempted: 'bg-surface-sunken text-ink-muted border-line',
  correct: 'bg-positive/12 text-positive border-positive/35',
  incorrect: 'bg-critical/12 text-critical border-critical/35',
  skipped: 'bg-caution/12 text-caution border-caution/35',
  marked: 'bg-accent-soft text-accent-ink border-accent/35',
};

/**
 * Question navigator. Shows every question's status at a glance and is the
 * primary navigation on mobile, where the per-question panel is full width.
 */
export function QuestionPalette({
  questions, attempts, currentId, onSelect, sectionNames,
}: {
  questions: Question[];
  attempts: Record<ID, QuestionAttempt>;
  currentId: ID | null;
  onSelect: (id: ID) => void;
  sectionNames: Record<ID, string>;
}) {
  const bySection = new Map<ID, Question[]>();
  for (const q of questions) {
    const list = bySection.get(q.sectionId) ?? [];
    list.push(q);
    bySection.set(q.sectionId, list);
  }

  return (
    <div className="space-y-4">
      {[...bySection.entries()].map(([sectionId, rows]) => (
        <div key={sectionId}>
          <div className="t-label mb-2">{sectionNames[sectionId] ?? 'Section'}</div>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-6">
            {rows.map((q) => {
              const status = attempts[q.id]?.status ?? 'unattempted';
              const active = q.id === currentId;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => onSelect(q.id)}
                  title={`Q${q.index} — ${STATUS_LABELS[status]}`}
                  aria-current={active}
                  className={cn(
                    't-num flex h-9 items-center justify-center rounded-md border text-xs font-medium transition-colors duration-150',
                    STATUS_SWATCH[status],
                    active && 'ring-2 ring-accent ring-offset-1 ring-offset-[rgb(var(--c-surface-raised))]',
                  )}
                >
                  {q.index}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-x-3 gap-y-1.5 border-t border-line pt-3">
        {(Object.keys(STATUS_LABELS) as QuestionStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-sm border', STATUS_SWATCH[s])} />
            <span className="t-meta">{STATUS_LABELS[s]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
