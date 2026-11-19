import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Play } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { formatDateKeyShort, relativeDayLabel, todayKey } from '@/lib/date';
import { toast } from '@/state/toastStore';
import { assignPaper, upcomingPaperSlots, type PaperSlot } from '@/services/examPlannerService';

export const useExamPlannerStore = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** True when any paper slot falls in the next two weeks (drives the bar button). */
export function useHasPaperSlots(): boolean {
  const today = todayKey();
  return (useLiveQuery(() => upcomingPaperSlots(today).then((s) => s.length > 0), [today]) ?? false);
}

function SlotRow({ slot, onDone }: { slot: PaperSlot; onDone: () => void }) {
  const [questions, setQuestions] = useState(slot.paper ? slot.paper.sections[0]?.questionCount ?? slot.defaultQuestions : slot.defaultQuestions);
  const current = slot.paper?.sections[0]?.trackerId;
  const locked = slot.paper !== null && slot.paper.status !== 'draft';

  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-ink">
          {relativeDayLabel(slot.date)}{' '}
          <span className="font-normal text-ink-faint">
            {relativeDayLabel(slot.date) === formatDateKeyShort(slot.date) ? '' : `· ${formatDateKeyShort(slot.date)} `}· {slot.ruleTitle}
          </span>
        </div>
        {slot.paper ? (
          <Link
            to={slot.paper.status === 'draft' ? `/focus/paper/${slot.paper.id}` : `/focus/paper/${slot.paper.id}/review`}
            className="flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline"
          >
            {slot.paper.status === 'draft' ? <><Play className="h-3 w-3" /> Start paper</> : <><FileText className="h-3 w-3" /> Review</>}
          </Link>
        ) : null}
      </div>
      {locked ? (
        <p className="t-meta">{slot.paper!.title} — {slot.paper!.status === 'in_progress' ? 'in progress' : 'done'}.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {slot.subjects.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={async () => {
                const res = await assignPaper(slot, s.id, questions);
                if (res.ok) { toast.success('Paper planned', res.message); onDone(); } else toast.warning('Not planned', res.message);
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                current === s.id ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
              )}
            >
              {s.name}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-faint">
            Questions
            <input
              inputMode="numeric"
              value={questions}
              onChange={(e) => setQuestions(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))}
              className="w-14 rounded-[var(--r-md)] bg-surface-sunken px-2 py-1 text-center text-sm text-ink t-num focus:outline-none focus:ring-2 focus:ring-accent/60"
            />
          </label>
        </div>
      )}
    </li>
  );
}

/** Pick the subject for each upcoming paper slot (exam-week papers, Sunday tests). */
export function ExamPlannerSheet() {
  const { open, hide } = useExamPlannerStore();
  const [slots, setSlots] = useState<PaperSlot[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    void upcomingPaperSlots(todayKey()).then(setSlots);
  }, [open, version]);

  if (!open) return null;
  return (
    <Modal
      open
      onClose={hide}
      size="lg"
      title="Plan papers"
      description="Choose the subject for each paper slot in the next two weeks. Each becomes a timed paper you run in Focus — score, accuracy and mistakes are recorded."
    >
      {slots === null ? (
        <p className="t-muted">Loading…</p>
      ) : slots.length === 0 ? (
        <p className="t-muted">No paper slots in the next two weeks.</p>
      ) : (
        <ul className="divide-y divide-line-faint overflow-hidden rounded-xl surface-card">
          {slots.map((s) => <SlotRow key={`${s.ruleId}:${s.date}`} slot={s} onDone={() => setVersion((v) => v + 1)} />)}
        </ul>
      )}
    </Modal>
  );
}
