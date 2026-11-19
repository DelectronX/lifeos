import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { db } from '@/db/db';
import {
  WEEKLY_QUESTIONS, getWeeklyReflection, saveWeeklyReflection,
  type WeeklyKey, type WeeklyPriority, type WeeklyReflection,
} from '@/services/reflectionService';
import type { DateKey, Tracker } from '@/types';

const field = 'w-full rounded-[var(--r-lg)] bg-surface-sunken px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/60';

/**
 * "Reflect & plan next week": three questions plus up to five priorities.
 * Priorities become real tasks (due end of next week), so Auto Plan can
 * place them; saving again never duplicates them.
 */
export function WeeklyReflectionCard({ weekStart }: { weekStart: DateKey }) {
  const trackers = useLiveQuery(() => db.trackers.toArray(), []) ?? [];
  const areas = useMemo(
    () => trackers.filter((t: Tracker) => !t.archived && t.pillar !== 'system').sort((a, b) => a.sortOrder - b.sortOrder),
    [trackers],
  );
  const [form, setForm] = useState<WeeklyReflection>({ answers: {}, priorities: [] });
  const [savedAt, setSavedAt] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getWeeklyReflection(weekStart).then((r) => {
      setForm(r ? { answers: r.answers, priorities: r.priorities } : { answers: {}, priorities: [] });
      setSavedAt(Boolean(r));
    });
  }, [weekStart]);

  const defaultArea = areas[0]?.id ?? 'trk_personal';
  const setAnswer = (k: WeeklyKey, v: string) => setForm((f) => ({ ...f, answers: { ...f.answers, [k]: v } }));
  const setPriority = (i: number, patch: Partial<WeeklyPriority>) =>
    setForm((f) => ({ ...f, priorities: f.priorities.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  const save = async () => {
    setSaving(true);
    try {
      const ids = await saveWeeklyReflection(weekStart, form);
      setSavedAt(true);
      toast.success('Weekly review saved', ids.length ? `${ids.length} priorit${ids.length === 1 ? 'y is' : 'ies are'} in Tasks for next week.` : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="t-title">Reflect &amp; plan next week</h2>
          <p className="t-meta mt-0.5">Saved reviews count toward your review achievements.</p>
        </div>
        {savedAt ? <span className="rounded-full bg-positive/15 px-2 py-0.5 text-xs text-positive">Saved</span> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {WEEKLY_QUESTIONS.map((q) => (
          <label key={q.key} className="block">
            <span className="mb-1 block text-sm text-ink-muted">{q.label}</span>
            <textarea rows={3} className={`${field} resize-none`} value={form.answers[q.key] ?? ''} onChange={(e) => setAnswer(q.key, e.target.value)} />
          </label>
        ))}
      </div>

      <div>
        <div className="t-label mb-2">Next week&apos;s priorities</div>
        <div className="space-y-2">
          {form.priorities.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={`${field} flex-1`}
                placeholder="e.g. Finish Chemistry chapter 4"
                value={p.title}
                onChange={(e) => setPriority(i, { title: e.target.value })}
              />
              <select className={`${field} w-40 shrink-0`} value={p.trackerId} onChange={(e) => setPriority(i, { trackerId: e.target.value })}>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button
                type="button"
                aria-label="Remove"
                className="shrink-0 rounded-lg px-2 text-ink-faint hover:bg-surface-overlay hover:text-ink"
                onClick={() => setForm((f) => ({ ...f, priorities: f.priorities.filter((_, j) => j !== i) }))}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {form.priorities.length < 5 ? (
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setForm((f) => ({ ...f, priorities: [...f.priorities, { title: '', trackerId: defaultArea }] }))}
            >
              Add priority
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" loading={saving} onClick={() => void save()}>Save review</Button>
      </div>
    </Card>
  );
}
