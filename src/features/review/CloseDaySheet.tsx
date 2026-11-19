import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, SkipForward } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatTime, todayKey } from '@/lib/date';
import { toast } from '@/state/toastStore';
import { requestCompleteBlock } from '@/state/completeBlockStore';
import { skipBlock } from '@/services/scheduleService';
import {
  REFLECTION_QUESTIONS, getDailyReflection, openRequiredBlocks, saveDailyReflection,
  type DailyReflection, type ReflectionKey,
} from '@/services/reflectionService';
import type { DateKey } from '@/types';

export const useCloseDayStore = create<{ date: DateKey | null; open: (d?: DateKey) => void; close: () => void }>((set) => ({
  date: null,
  open: (d) => set({ date: d ?? todayKey() }),
  close: () => set({ date: null }),
}));

function Scale({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              'h-8 w-8 rounded-full border text-sm t-num transition-colors',
              value === n ? 'border-accent bg-accent text-accent-contrast' : 'border-line text-ink-muted hover:border-line-strong',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * End-of-day sheet: settle every still-open required block in one place,
 * then answer the reflection questions. Mounted once in the app shell.
 */
export function CloseDaySheet() {
  const { date, close } = useCloseDayStore();
  const open = useLiveQuery(() => (date ? openRequiredBlocks(date) : Promise.resolve([])), [date]) ?? [];
  const [form, setForm] = useState<DailyReflection>({ answers: {} });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!date) return;
    void getDailyReflection(date).then((r) => setForm(r ?? { answers: {} }));
  }, [date]);

  if (!date) return null;
  const setAnswer = (k: ReflectionKey, v: string) => setForm((f) => ({ ...f, answers: { ...f.answers, [k]: v } }));

  const save = async () => {
    setSaving(true);
    await saveDailyReflection(date, form);
    setSaving(false);
    toast.success('Day closed', open.length ? `${open.length} block${open.length === 1 ? '' : 's'} left open.` : 'Everything settled.');
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      size="lg"
      title="Close the day"
      description="Settle what's still open, then take two minutes to reflect."
      footer={
        <>
          <Button variant="ghost" onClick={close}>Later</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save reflection</Button>
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <div className="t-label mb-2">Still open {open.length ? `· ${open.length}` : ''}</div>
          {open.length === 0 ? (
            <p className="text-sm text-positive">Every required block today is settled.</p>
          ) : (
            <ul className="divide-y divide-line-faint overflow-hidden rounded-xl surface-card">
              {open.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-12 shrink-0 text-xs text-ink-muted t-num">{formatTime(b.start)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{b.title}</span>
                  <Button size="sm" variant="secondary" iconLeft={<Check className="h-3.5 w-3.5" />} onClick={() => void requestCompleteBlock(b)}>
                    Done
                  </Button>
                  <Button size="sm" variant="ghost" iconLeft={<SkipForward className="h-3.5 w-3.5" />} onClick={() => void skipBlock(b.id)}>
                    Skip
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <div className="t-label">Reflection</div>
          {REFLECTION_QUESTIONS.map((q) => (
            <label key={q.key} className="block">
              <span className="mb-1 block text-sm text-ink-muted">{q.label}</span>
              <textarea
                rows={2}
                value={form.answers[q.key] ?? ''}
                onChange={(e) => setAnswer(q.key, e.target.value)}
                className="w-full resize-none rounded-[var(--r-lg)] bg-surface-sunken px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
              />
            </label>
          ))}
          <Scale label="Energy" value={form.energy} onChange={(v) => setForm((f) => ({ ...f, energy: v }))} />
          <Scale label="Mood" value={form.mood} onChange={(v) => setForm((f) => ({ ...f, mood: v }))} />
        </section>
      </div>
    </Modal>
  );
}
