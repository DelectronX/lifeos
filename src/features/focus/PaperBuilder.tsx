import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Toggle } from '@/components/ui/Input';
import { useTrackers } from '@/state/useLiveData';
import {
  createPaper, expectedSecondsPerQuestion, totalMarks, totalQuestions, validatePaperDraft,
  type PaperDraft, type SectionDraft,
} from '@/services/paperService';
import { toast } from '@/state/toastStore';
import { formatDuration, todayKey } from '@/lib/date';
import type { ID } from '@/types';

const emptySection = (trackerId: ID): SectionDraft => ({
  name: '',
  trackerId,
  questionCount: 25,
  marksPerQuestion: 4,
  negativeMarks: 1,
});

/** Multi-subject mock paper builder. Persists a Paper plus one Question per slot. */
export function PaperBuilder({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: ID) => void;
}) {
  const trackers = useTrackers();
  const defaultTracker = trackers.find((t) => t.pillar === 'study')?.id ?? trackers[0]?.id ?? '';

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayKey());
  const [durationMinutes, setDurationMinutes] = useState('180');
  const [timed, setTimed] = useState(true);
  const [sections, setSections] = useState<SectionDraft[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const effectiveSections = sections.length ? sections : [emptySection(defaultTracker)];

  const draft: PaperDraft = useMemo(() => ({
    title,
    date,
    durationMinutes: Math.max(1, Math.round(Number(durationMinutes) || 0)),
    timed,
    sections: effectiveSections,
  }), [title, date, durationMinutes, timed, effectiveSections]);

  const issues = validatePaperDraft(draft);
  const issueFor = (field: string) => (touched ? issues.find((i) => i.field === field)?.message ?? null : null);

  const setSection = (i: number, patch: Partial<SectionDraft>) =>
    setSections(effectiveSections.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const reset = () => {
    setTitle(''); setDate(todayKey()); setDurationMinutes('180'); setTimed(true);
    setSections([]); setTouched(false);
  };

  const save = async () => {
    setTouched(true);
    if (issues.length) { toast.error('Fix the highlighted fields'); return; }
    setBusy(true);
    try {
      const paper = await createPaper(draft);
      toast.success('Paper created', `${totalQuestions(draft)} questions · ${totalMarks(draft)} marks`);
      onCreated?.(paper.id);
      reset();
      onClose();
    } catch (e) {
      toast.error('Could not create paper', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New mock paper"
      description="Add a section per subject. Questions are numbered across the whole paper."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>Create paper</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Paper name" required error={issueFor('title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. JEE Main Full Test 04" autoFocus />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Total duration (min)" required error={issueFor('durationMinutes')}>
            <Input type="number" min={1} step={5} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
          </Field>
          <div className="flex items-end pb-1">
            <Toggle
              checked={timed}
              onChange={setTimed}
              label="Timed"
              description="Runs a global countdown."
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="t-label">Sections</span>
            <Button
              size="xs"
              variant="subtle"
              iconLeft={<Plus className="h-3 w-3" />}
              onClick={() => setSections([...effectiveSections, emptySection(defaultTracker)])}
            >
              Add section
            </Button>
          </div>
          {touched && issueFor('sections') ? (
            <div className="mb-2 text-xs text-critical">{issueFor('sections')}</div>
          ) : null}

          <div className="space-y-3">
            {effectiveSections.map((s, i) => (
              <div key={i} className="rounded-lg border border-line bg-surface-sunken p-3">
                <div className="mb-3 flex items-center gap-2">
                  <Input
                    value={s.name}
                    onChange={(e) => setSection(i, { name: e.target.value })}
                    placeholder={`Section ${i + 1} name (e.g. Physics)`}
                    invalid={!!issueFor(`sections.${i}.name`)}
                    className="flex-1"
                  />
                  <IconButton
                    label="Remove section"
                    size="sm"
                    disabled={effectiveSections.length === 1}
                    onClick={() => setSections(effectiveSections.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Tracker">
                    <Select sizeVariant="sm" value={s.trackerId} onChange={(e) => setSection(i, { trackerId: e.target.value })}>
                      {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Questions">
                    <Input
                      sizeVariant="sm" type="number" min={1} value={s.questionCount}
                      onChange={(e) => setSection(i, { questionCount: Math.max(1, Math.round(Number(e.target.value) || 0)) })}
                    />
                  </Field>
                  <Field label="Marks / Q">
                    <Input
                      sizeVariant="sm" type="number" min={1} step={0.5} value={s.marksPerQuestion}
                      onChange={(e) => setSection(i, { marksPerQuestion: Number(e.target.value) || 0 })}
                    />
                  </Field>
                  <Field label="Negative">
                    <Input
                      sizeVariant="sm" type="number" min={0} step={0.25} value={s.negativeMarks}
                      onChange={(e) => setSection(i, { negativeMarks: Math.abs(Number(e.target.value) || 0) })}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line px-3 py-2.5">
          <div className="t-meta">
            {totalQuestions(draft)} questions · {totalMarks(draft)} marks ·{' '}
            {formatDuration(draft.durationMinutes)} ·{' '}
            {expectedSecondsPerQuestion(draft)}s per question as the pacing baseline.
          </div>
        </div>
      </div>
    </Modal>
  );
}
