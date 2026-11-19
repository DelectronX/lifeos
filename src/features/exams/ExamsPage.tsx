import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { GraduationCap, Plus, Trash2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { InsetGroup, Meter, MetricTile, Row } from '@/components/ui/Grouped';
import { db } from '@/db/db';
import { formatDateKeyShort, todayKey } from '@/lib/date';
import { cn } from '@/lib/cn';
import { newId } from '@/lib/id';
import { MISTAKE_LABELS } from '@/engines/paperAnalytics';
import { examSummary, scoreTotal } from '@/engines/workgrowth';
import { addScore, createExamTrack, deleteExamTrack, deleteScore, updateExamTrack } from '@/services/workgrowthService';
import type { ExamTrack, ScoreEntry } from '@/types/workgrowth';

/** Presets only pre-fill the form; every value is editable and stored as data. */
const PRESETS: Record<string, Omit<ExamTrack, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder' | 'title'>> = {
  'Scaled · two sections (e.g. SAT)': {
    family: 'SAT', minTotal: 400, maxTotal: 1600,
    sections: [{ id: 'rw', name: 'Reading & Writing', min: 200, max: 800 }, { id: 'math', name: 'Math', min: 200, max: 800 }],
  },
  'Single 1–5 score (e.g. AP)': {
    family: 'AP', minTotal: 1, maxTotal: 5, directTotal: true,
    sections: [{ id: 'mcq', name: 'Multiple choice %', min: 0, max: 100 }, { id: 'frq', name: 'Free response %', min: 0, max: 100 }],
  },
  Custom: { sections: [{ id: 's1', name: 'Section 1', max: 100 }] },
};

export function ExamsPage() {
  const tracks = useLiveQuery(() => db.examTracks.orderBy('sortOrder').toArray(), []) ?? [];
  const scores = useLiveQuery(() => db.scores.toArray(), []) ?? [];
  const questions = useLiveQuery(() => db.questions.toArray(), []) ?? [];
  const attempts = useLiveQuery(() => db.attempts.toArray(), []) ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [logging, setLogging] = useState(false);
  const track = tracks.find((t) => t.id === selected) ?? tracks[0];
  const today = todayKey();

  return (
    <Page
      title="Exams"
      subtitle="Score dashboards per exam. Domain accuracy and mistake types come straight from the papers you record in Practice."
      actions={(
        <div className="flex gap-2">
          <Button variant="secondary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New exam</Button>
          {track ? <Button variant="primary" onClick={() => setLogging(true)}>Log a score</Button> : null}
        </div>
      )}
    >
      {tracks.length === 0 ? (
        <EmptyState icon={<GraduationCap className="h-6 w-6" />} title="No exams yet"
          description="Add SAT, each AP subject, or any scored exam. Set a target and exam date to see the gap and countdown."
          action={<Button variant="primary" onClick={() => setCreating(true)}>New exam</Button>} />
      ) : (
        <>
          {tracks.length > 1 ? (
            <div className="mb-6 max-w-2xl overflow-x-auto">
              <SegmentedControl aria-label="Exam" value={track!.id} onChange={setSelected} items={tracks.map((t) => ({ value: t.id, label: t.title }))} />
            </div>
          ) : null}
          {track ? <Dashboard track={track} scores={scores} questions={questions} attempts={attempts} today={today} /> : null}
        </>
      )}
      {creating ? <TrackSheet onClose={() => setCreating(false)} onCreated={setSelected} /> : null}
      {logging && track ? <ScoreSheet track={track} onClose={() => setLogging(false)} /> : null}
    </Page>
  );
}

function Dashboard({ track, scores, questions, attempts, today }: {
  track: ExamTrack; scores: ScoreEntry[]; questions: Parameters<typeof examSummary>[2] extends readonly (infer Q)[] ? Q[] : never;
  attempts: Parameters<typeof examSummary>[3] extends readonly (infer A)[] ? A[] : never; today: string;
}) {
  const s = useMemo(() => examSummary(track, scores, questions, attempts, today), [track, scores, questions, attempts, today]);
  const trackers = useLiveQuery(() => db.trackers.toArray(), []) ?? [];
  const lo = track.minTotal ?? 0;
  const hi = track.maxTotal ?? Math.max(1, ...s.trend.map((x) => x.total), track.target ?? 0);
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / Math.max(1, hi - lo)) * 100));
  const mistakeTotal = s.mistakes.reduce((n, m) => n + m.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Latest" value={s.latest?.total ?? '—'} tone="accent"
          caption={s.delta !== null ? `${s.delta >= 0 ? '+' : ''}${s.delta} vs previous` : s.latest ? s.latest.label : 'No scores yet'} />
        <MetricTile label="Best" value={s.best?.total ?? '—'} caption={s.best ? formatDateKeyShort(s.best.date) : undefined} />
        <MetricTile label="Target" value={track.target ?? '—'}
          caption={track.target === undefined ? 'Set a target below' : s.gapToTarget === null ? 'No score yet' : s.gapToTarget <= 0 ? 'Reached' : `${s.gapToTarget} to go`}
          tone={s.gapToTarget !== null && s.gapToTarget <= 0 ? 'positive' : 'default'} />
        <MetricTile label="Exam day" value={track.examDate ? formatDateKeyShort(track.examDate) : '—'}
          caption={s.daysToExam !== null ? (s.daysToExam >= 0 ? `${s.daysToExam} days left` : 'Past') : 'Set the date'}
          tone={s.daysToExam !== null && s.daysToExam >= 0 && s.daysToExam <= 14 ? 'caution' : 'default'} />
      </div>

      <InsetGroup header="Score trend" footer={track.target !== undefined ? 'Dashed line: target.' : undefined}>
        {s.trend.length === 0 ? <Row title={<span className="text-ink-muted">Log a practice or official score to start the trend.</span>} /> : (
          <div className="relative h-48 px-4 pb-6 pt-4">
            {track.target !== undefined ? (
              <div className="absolute inset-x-4 border-t border-dashed border-positive/70" style={{ bottom: `calc(1.5rem + ${pct(track.target)}% * 0.82)` }} />
            ) : null}
            <div className="flex h-full items-end gap-2">
              {s.trend.map((p, i) => (
                <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${p.label}: ${p.total}`}>
                  <span className="text-[0.6875rem] tabular text-ink-muted">{p.total}</span>
                  <div className={cn('w-full max-w-[2rem] rounded-t', p.kind === 'official' ? 'bg-accent' : 'bg-accent/45')} style={{ height: `${Math.max(4, pct(p.total) * 0.82)}%` }} />
                  <span className="truncate text-[0.625rem] text-ink-faint">{formatDateKeyShort(p.date)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </InsetGroup>

      <div className="grid gap-6 lg:grid-cols-2">
        <InsetGroup header="Sections">
          {track.sections.map((sec) => {
            const pts = s.sectionTrend[sec.id] ?? [];
            const last = pts[pts.length - 1]?.score;
            const min = sec.min ?? 0;
            return (
              <Row key={sec.id} title={sec.name}
                subtitle={<Meter className="mt-1.5" value={last !== undefined ? (last - min) / Math.max(1, sec.max - min) : 0} />}
                trailing={<span className="tabular">{last ?? '—'}<span className="text-ink-faint"> / {sec.max}</span></span>} />
            );
          })}
        </InsetGroup>

        <InsetGroup header="Mistake mix" footer="From incorrect answers in Practice papers for this exam's subjects.">
          {s.mistakes.length === 0 ? <Row title={<span className="text-ink-muted">No tagged mistakes yet.</span>} /> : s.mistakes.map((m) => (
            <Row key={m.type} title={MISTAKE_LABELS[m.type]} subtitle={<Meter className="mt-1.5" tone="caution" value={m.count / mistakeTotal} />}
              trailing={<span className="tabular">{m.count}</span>} />
          ))}
        </InsetGroup>
      </div>

      <InsetGroup header="Domains · weakest first" footer="Domains are the question topics in Practice papers. Link each section to a subject in the exam settings below.">
        {s.domains.length === 0 ? <Row title={<span className="text-ink-muted">No answered questions linked to this exam yet.</span>} /> : s.domains.slice(0, 15).map((d) => (
          <Row key={`${d.trackerId}${d.domain}`} title={d.domain}
            subtitle={`${trackers.find((t) => t.id === d.trackerId)?.name ?? ''} · ${d.correct}/${d.attempted} correct`}
            trailing={<span className={cn('tabular', d.accuracy < 0.6 ? 'text-critical' : d.accuracy < 0.8 ? 'text-caution' : 'text-positive')}>{Math.round(d.accuracy * 100)}%</span>} />
        ))}
      </InsetGroup>

      <InsetGroup header="Score log">
        {[...scores.filter((x) => x.trackId === track.id)].sort((a, b) => (a.date < b.date ? 1 : -1)).map((x) => (
          <Row key={x.id} title={x.label} subtitle={`${formatDateKeyShort(x.date)} · ${x.kind} · ${track.sections.map((sec) => `${sec.name} ${x.sections[sec.id] ?? '—'}`).join(' · ')}`}
            trailing={<><span className="tabular text-ink">{x.total}</span><IconButton label="Delete score" size="xs" variant="ghost" onClick={() => void deleteScore(x.id)}><Trash2 className="h-3.5 w-3.5" /></IconButton></>} />
        ))}
      </InsetGroup>

      <InsetGroup header="Exam settings">
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
          <Field label="Target"><Input inputMode="numeric" defaultValue={track.target ?? ''} onBlur={(e) => void updateExamTrack(track.id, { target: Number(e.target.value) || undefined })} /></Field>
          <Field label="Exam date"><Input type="date" value={track.examDate ?? ''} onChange={(e) => void updateExamTrack(track.id, { examDate: e.target.value || null })} /></Field>
          <div className="flex items-end"><Button variant="ghost" className="text-critical" onClick={() => { if (confirm(`Delete ${track.title} and its score log?`)) void deleteExamTrack(track.id); }}>Delete exam</Button></div>
          {track.sections.map((sec) => (
            <Field key={sec.id} label={`${sec.name} → subject`}>
              <Select value={sec.trackerId ?? ''} onChange={(e) => void updateExamTrack(track.id, { sections: track.sections.map((x) => (x.id === sec.id ? { ...x, trackerId: e.target.value || null } : x)) })}>
                <option value="">None</option>
                {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      </InsetGroup>
    </div>
  );
}

function TrackSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [preset, setPreset] = useState(Object.keys(PRESETS)[0]!);
  const [target, setTarget] = useState('');
  const [examDate, setExamDate] = useState('');
  const save = async () => {
    const p = PRESETS[preset]!;
    const t = await createExamTrack({
      ...p, title: title.trim(), sections: p.sections.map((s) => ({ ...s, id: `${s.id}_${newId('x').slice(-4)}` })),
      target: Number(target) || undefined, examDate: examDate || null,
    });
    onCreated(t.id);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="New exam" size="md"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim()} onClick={() => void save()}>Create</Button></div>}>
      <div className="space-y-4">
        <Field label="Name" required><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="SAT · AP Calculus BC · …" /></Field>
        <Field label="Scoring"><Select value={preset} onChange={(e) => setPreset(e.target.value)}>{Object.keys(PRESETS).map((k) => <option key={k}>{k}</option>)}</Select></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target score"><Input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9]/g, ''))} /></Field>
          <Field label="Exam date"><Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function ScoreSheet({ track, onClose }: { track: ExamTrack; onClose: () => void }) {
  const [label, setLabel] = useState('Practice test');
  const [kind, setKind] = useState<ScoreEntry['kind']>('practice');
  const [date, setDate] = useState(todayKey());
  const [secs, setSecs] = useState<Record<string, string>>({});
  const [direct, setDirect] = useState('');
  const sections = Object.fromEntries(Object.entries(secs).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
  const total = scoreTotal(track, sections, Number(direct) || undefined);
  const valid = track.directTotal ? Number(direct) > 0 : Object.keys(sections).length > 0;
  return (
    <Modal open onClose={onClose} title={`Log ${track.title} score`} size="md"
      footer={<div className="flex items-center justify-between gap-2"><span className="text-[0.9375rem] tabular text-ink-muted">Total <span className="text-ink">{total}</span></span><div className="flex gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid}
        onClick={() => void addScore({ trackId: track.id, label: label.trim() || 'Score', kind, date, sections, total }).then(onClose)}>Save</Button></div></div>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bluebook Practice 4" /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Type"><SegmentedControl aria-label="Type" fullWidth value={kind} onChange={setKind} items={[{ value: 'practice', label: 'Practice' }, { value: 'mock', label: 'Full mock' }, { value: 'official', label: 'Official' }]} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {track.sections.map((sec) => (
            <Field key={sec.id} label={`${sec.name} (${sec.min ?? 0}–${sec.max})`}>
              <Input inputMode="numeric" value={secs[sec.id] ?? ''} onChange={(e) => setSecs({ ...secs, [sec.id]: e.target.value.replace(/[^0-9]/g, '') })} />
            </Field>
          ))}
          {track.directTotal ? (
            <Field label={`Overall (${track.minTotal ?? 1}–${track.maxTotal ?? 5})`} required>
              <Input inputMode="numeric" value={direct} onChange={(e) => setDirect(e.target.value.replace(/[^0-9]/g, ''))} />
            </Field>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
