import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookMarked, Check, ChevronRight, FlaskConical, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { CheckCircle, HealthChip, InsetGroup, MetricTile, Row } from '@/components/ui/Grouped';
import { db } from '@/db/db';
import { formatDateKeyShort, relativeDayLabel, todayKey } from '@/lib/date';
import { cn } from '@/lib/cn';
import { toast } from '@/state/toastStore';
import { SKILL_LEVELS, scheduleHealth, skillGap, studyProgress, thinThemes } from '@/engines/workgrowth';
import {
  addSkillEvidence, createSkill, createSource, createStudy, deleteSkill, deleteSource, deleteStudy, parseReference,
  toggleSkillPathItem, updateSkill, updateSource, updateStudy,
} from '@/services/workgrowthService';
import { newId } from '@/lib/id';
import type {
  ManuscriptSection, Skill, SkillEvidence, SkillLevel, Source, SourceStatus, Study, StudyKind, StudyStage,
} from '@/types/workgrowth';

/* ================================================================== */
/* Research                                                            */
/* ================================================================== */

const STAGES: Array<{ value: StudyStage; label: string }> = [
  { value: 'planning', label: 'Plan' }, { value: 'searching', label: 'Search' }, { value: 'screening', label: 'Screen' },
  { value: 'reading', label: 'Read' }, { value: 'synthesis', label: 'Synthesise' }, { value: 'writing', label: 'Write' },
  { value: 'revising', label: 'Revise' }, { value: 'submitted', label: 'Submitted' }, { value: 'published', label: 'Published' },
];
const SOURCE_STATUS: Array<{ value: SourceStatus; label: string }> = [
  { value: 'to_read', label: 'To read' }, { value: 'skimmed', label: 'Skimmed' }, { value: 'read', label: 'Read' },
  { value: 'extracted', label: 'Extracted' }, { value: 'excluded', label: 'Excluded' },
];
const SECTION_STATUS: ManuscriptSection['status'][] = ['todo', 'outline', 'draft', 'revised', 'done'];

export function ResearchPage() {
  const studies = useLiveQuery(() => db.studies.orderBy('sortOrder').toArray(), []) ?? [];
  const sources = useLiveQuery(() => db.sources.toArray(), []) ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'studies' | 'library'>('studies');
  const [creating, setCreating] = useState(false);
  const [addingSource, setAddingSource] = useState(false);
  const study = studies.find((s) => s.id === selected) ?? studies[0];
  const today = todayKey();

  return (
    <Page
      title="Research"
      subtitle="Literature reviews and papers — question, search strategy, an extraction matrix, and the manuscript."
      wide
      actions={(
        <div className="flex gap-2">
          <Button variant="secondary" iconLeft={<BookMarked className="h-4 w-4" />} onClick={() => setAddingSource(true)}>Add source</Button>
          <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New study</Button>
        </div>
      )}
      toolbar={(
        <div className="w-full max-w-xs">
          <SegmentedControl aria-label="View" fullWidth value={view} onChange={setView}
            items={[{ value: 'studies', label: `Studies${studies.length ? ` ${studies.length}` : ''}` }, { value: 'library', label: `Library${sources.length ? ` ${sources.length}` : ''}` }]} />
        </div>
      )}
    >
      {view === 'library' ? <LibraryView sources={sources} studies={studies} /> : studies.length === 0 ? (
        <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="No research yet"
          description="Start a literature review or a paper. Each study owns a goal, so its milestones and tasks show up in Tasks and Auto Plan."
          action={<Button variant="primary" onClick={() => setCreating(true)}>New study</Button>} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* Study rail */}
          <nav aria-label="Studies" className="space-y-1.5 lg:sticky lg:top-2 lg:self-start">
            {studies.map((s) => {
              const sp = studyProgress(s, sources);
              const active = s.id === study?.id;
              const at = STAGES.findIndex((x) => x.value === s.stage);
              return (
                <button key={s.id} type="button" onClick={() => setSelected(s.id)} aria-current={active ? 'true' : undefined}
                  className={cn('surface-hover w-full rounded-[var(--r-lg)] p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                    active ? 'surface-card ring-1 ring-accent/50' : 'bg-transparent hover:bg-ink/[0.04]')}>
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold text-ink">{s.title}</span>
                    <span className="t-num shrink-0 text-[0.75rem] text-ink-muted">{Math.round(sp.progress * 100)}%</span>
                  </div>
                  <div className="mt-1 text-[0.75rem] text-ink-faint">{KIND_LABEL[s.kind]} · {STAGES[at]?.label}</div>
                  <div className="mt-2 flex gap-[2px]" aria-hidden>
                    {STAGES.map((x, i) => <span key={x.value} className={cn('h-1 flex-1 rounded-full', i < at ? 'bg-accent/60' : i === at ? 'bg-accent' : 'bg-ink/10')} />)}
                  </div>
                </button>
              );
            })}
          </nav>
          {study ? <StudyWorkspace key={study.id} study={study} sources={sources} today={today} onAddSource={() => setAddingSource(true)} /> : null}
        </div>
      )}

      {creating ? <NewStudySheet onClose={() => setCreating(false)} onCreated={(id) => { setSelected(id); setView('studies'); }} /> : null}
      {addingSource ? <SourceSheet studies={studies} defaultStudyId={view === 'studies' ? study?.id : undefined} onClose={() => setAddingSource(false)} /> : null}
    </Page>
  );
}

const KIND_LABEL: Record<StudyKind, string> = { literature_review: 'Literature review', paper: 'Paper', experiment: 'Experiment' } as Record<StudyKind, string>;

function StudyWorkspace({ study, sources, today, onAddSource }: { study: Study; sources: Source[]; today: string; onAddSource: () => void }) {
  const p = studyProgress(study, sources);
  const mine = sources.filter((s) => s.studyIds.includes(study.id));
  const gaps = thinThemes(p);
  const health = scheduleHealth(p.progress, null, study.targetDate, today, study.stage === 'submitted' || study.stage === 'published');
  const [theme, setTheme] = useState('');
  const [newSection, setNewSection] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stageIndex = STAGES.findIndex((s) => s.value === study.stage);
  const readingShare = p.sources ? p.extracted / p.sources : 0;
  const sectionWeight = { todo: 0, outline: 0.2, draft: 0.5, revised: 0.8, done: 1 } as const;
  const writingShare = study.sections.length ? study.sections.reduce((s, x) => s + sectionWeight[x.status], 0) / study.sections.length : 0;
  const maxTheme = Math.max(1, ...p.themes.map((t) => t.sources));

  const patchSection = (id: string, patch: Partial<ManuscriptSection>) =>
    void updateStudy(study.id, { sections: study.sections.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  return (
    <div className="min-w-0 space-y-6">
      {/* Editorial header */}
      <header className="surface-card rounded-[var(--r-xl)] p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[0.75rem] font-medium text-ink-faint">{KIND_LABEL[study.kind]}{study.venue ? ` · ${study.venue}` : ''}</div>
            <h2 className="t-title2 mt-0.5">{study.title}</h2>
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              {study.targetDate ? `Target ${formatDateKeyShort(study.targetDate)} · ${relativeDayLabel(study.targetDate, today)}` : 'No target date'}
            </p>
          </div>
          <HealthChip health={health} />
          <IconButton label="Delete study" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></IconButton>
        </div>

        {/* Stage pipeline */}
        <ol className="mt-5 flex items-start overflow-x-auto pb-1 scrollbar-none" aria-label="Stage">
          {STAGES.map((s, i) => {
            const state = i < stageIndex ? 'done' : i === stageIndex ? 'current' : 'todo';
            return (
              <li key={s.value} className="flex min-w-[4.25rem] flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  <span className={cn('h-px flex-1', i === 0 ? 'opacity-0' : state === 'todo' ? 'bg-ink/10' : 'bg-accent/60')} />
                  <button type="button" aria-current={state === 'current' ? 'step' : undefined} aria-label={`Set stage: ${s.label}`}
                    onClick={() => void updateStudy(study.id, { stage: s.value })}
                    className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full transition-[transform,background-color] hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                      state === 'done' ? 'bg-accent/70 text-accent-contrast' : state === 'current' ? 'bg-accent text-accent-contrast ring-4 ring-accent/20' : 'bg-ink/10')}>
                    {state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </button>
                  <span className={cn('h-px flex-1', i === STAGES.length - 1 ? 'opacity-0' : i < stageIndex ? 'bg-accent/60' : 'bg-ink/10')} />
                </div>
                <span className={cn('mt-1.5 text-[0.6875rem]', state === 'current' ? 'font-semibold text-ink' : 'text-ink-faint')}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      </header>

      {/* Progress composition */}
      <section className="surface-card rounded-[var(--r-xl)] p-5" aria-label="Progress">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <div className="t-num t-rounded text-[2.25rem] font-semibold leading-none tracking-[-0.03em] text-ink">{Math.round(p.progress * 100)}<span className="text-[1rem] text-ink-faint">%</span></div>
            <div className="mt-1 text-[0.75rem] text-ink-muted">overall · 40% reading, 60% writing</div>
          </div>
          <div className="min-w-[14rem] flex-1 space-y-2.5">
            {[{ k: 'Reading', v: readingShare, cap: `${p.extracted}/${p.sources} extracted` }, { k: 'Writing', v: writingShare, cap: `${p.sectionsDone}/${p.sectionsTotal} sections · ${p.words.toLocaleString()}${p.targetWords ? ` / ${p.targetWords.toLocaleString()}` : ''} words` }].map((r) => (
              <div key={r.k}>
                <div className="flex justify-between text-[0.75rem]"><span className="font-medium text-ink">{r.k}</span><span className="t-num text-ink-muted">{r.cap}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-calm" style={{ width: `${r.v * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <dl className="grid grid-cols-3 gap-6">
            {[['Sources', p.sources], ['Read', p.read], ['Excluded', p.excluded]].map(([k, v]) => (
              <div key={k as string}><dt className="text-[0.6875rem] text-ink-faint">{k}</dt><dd className="t-num text-[1.125rem] font-semibold text-ink">{v}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <InsetGroup header="Protocol">
          <div className="space-y-3 px-4 py-3">
            <Field label="Research question"><Textarea rows={2} defaultValue={study.question ?? ''} onBlur={(e) => void updateStudy(study.id, { question: e.target.value })} /></Field>
            <Field label="Search strategy" hint="Databases, keywords, inclusion and exclusion criteria.">
              <Textarea rows={3} defaultValue={study.searchStrategy ?? ''} onBlur={(e) => void updateStudy(study.id, { searchStrategy: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Target date"><Input type="date" value={study.targetDate ?? ''} onChange={(e) => void updateStudy(study.id, { targetDate: e.target.value || null })} /></Field>
              <Field label="Venue"><Input defaultValue={study.venue ?? ''} placeholder="Journal / competition" onBlur={(e) => void updateStudy(study.id, { venue: e.target.value || undefined })} /></Field>
            </div>
          </div>
        </InsetGroup>

        <InsetGroup header="Evidence map" footer={gaps.length ? `Thin evidence: ${gaps.join(', ')} — fewer than 2 sources. Gaps to search, or to argue.` : 'Tag sources with themes to build the synthesis.'}>
          <ul className="space-y-2.5 px-4 py-3">
            {p.themes.map((t) => (
              <li key={t.theme}>
                <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
                  <span className="min-w-0 truncate text-ink">{t.theme}</span>
                  <span className={cn('t-num shrink-0', t.sources < 2 ? 'text-caution' : 'text-ink-muted')}>{t.sources}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink/10">
                  <div className={cn('h-full rounded-full transition-[width] duration-700 ease-calm', t.sources < 2 ? 'bg-caution' : 'bg-accent')} style={{ width: `${(t.sources / maxTheme) * 100}%` }} />
                </div>
              </li>
            ))}
            {p.themes.length === 0 ? <li className="t-meta">No themes yet.</li> : null}
          </ul>
          <form className="flex gap-2 px-4 pb-3" onSubmit={(e) => { e.preventDefault(); if (theme.trim()) void updateStudy(study.id, { themes: [...new Set([...study.themes, theme.trim()])] }).then(() => setTheme('')); }}>
            <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Add a theme" aria-label="New theme" />
            <Button type="submit" size="sm" variant="secondary" disabled={!theme.trim()}>Add</Button>
          </form>
        </InsetGroup>
      </div>

      <InsetGroup header="Manuscript">
        {study.sections.map((sec) => {
          const ratio = sec.targetWords ? Math.min(1, (sec.words ?? 0) / sec.targetWords) : sectionWeight[sec.status];
          return (
            <div key={sec.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', sec.status === 'done' ? 'bg-positive' : sec.status === 'todo' ? 'bg-ink/20' : 'bg-accent')} aria-hidden />
                <span className="min-w-0 flex-1 text-[0.9375rem] text-ink">{sec.title}</span>
                <Input aria-label={`${sec.title} words written`} inputMode="numeric" className="h-8 w-20 text-xs" defaultValue={sec.words ?? ''} placeholder="words"
                  onBlur={(e) => patchSection(sec.id, { words: Number(e.target.value) || undefined })} />
                <Input aria-label={`${sec.title} target words`} inputMode="numeric" className="h-8 w-20 text-xs" defaultValue={sec.targetWords ?? ''} placeholder="target"
                  onBlur={(e) => patchSection(sec.id, { targetWords: Number(e.target.value) || undefined })} />
                <Select aria-label={`${sec.title} status`} className="h-8 w-28 text-xs" value={sec.status}
                  onChange={(e) => patchSection(sec.id, { status: e.target.value as ManuscriptSection['status'] })}>
                  {SECTION_STATUS.map((x) => <option key={x} value={x}>{x[0]!.toUpperCase() + x.slice(1)}</option>)}
                </Select>
              </div>
              <div className="ml-5 mt-2 h-1 overflow-hidden rounded-full bg-ink/[0.07]" aria-hidden>
                <div className={cn('h-full rounded-full transition-[width] duration-700 ease-calm', sec.status === 'done' ? 'bg-positive' : 'bg-accent/70')} style={{ width: `${ratio * 100}%` }} />
              </div>
            </div>
          );
        })}
        <form className="flex gap-2 px-4 py-2.5" onSubmit={(e) => {
          e.preventDefault();
          const t = newSection.trim();
          if (t) void updateStudy(study.id, { sections: [...study.sections, { id: newId('sec'), title: t, status: 'todo' }] }).then(() => setNewSection(''));
        }}>
          <Input value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder="Add a section — e.g. Discussion" aria-label="New section title" />
          <Button type="submit" size="sm" variant="secondary" disabled={!newSection.trim()}>Add</Button>
        </form>
      </InsetGroup>

      <div>
        <div className="mb-2 flex items-end justify-between px-1">
          <h3 className="t-title3">Literature matrix <span className="t-num text-[0.875rem] font-medium text-ink-faint">{mine.length}</span></h3>
          <Button size="sm" variant="ghost" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={onAddSource}>Add source</Button>
        </div>
        <SourceTable sources={mine} studies={[study]} compact />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        confirmLabel="Delete study"
        title={`Delete “${study.title}”?`}
        message="The study and its goal are removed. Sources stay in the library."
        onConfirm={async () => { await deleteStudy(study.id); toast.success('Study deleted'); setConfirmDelete(false); }}
      />
    </div>
  );
}

/** Library: the source pipeline (to read → extracted) as a filter, above the matrix. */
function LibraryView({ sources, studies }: { sources: Source[]; studies: Study[] }) {
  const [status, setStatus] = useState<SourceStatus | 'all'>('all');
  const counts = useMemo(() => Object.fromEntries(SOURCE_STATUS.map((x) => [x.value, sources.filter((s) => s.status === x.value).length])), [sources]) as Record<SourceStatus, number>;
  const shown = status === 'all' ? sources : sources.filter((s) => s.status === status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-stretch gap-2" role="radiogroup" aria-label="Filter by status">
        {(['all', ...SOURCE_STATUS.map((x) => x.value)] as const).map((v, i) => {
          const on = status === v;
          const n = v === 'all' ? sources.length : counts[v as SourceStatus];
          return (
            <button key={v} type="button" role="radio" aria-checked={on} onClick={() => setStatus(v)}
              className={cn('surface-hover flex min-w-[6.5rem] flex-col items-start rounded-[var(--r-lg)] px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                on ? 'surface-card ring-1 ring-accent/50' : 'bg-ink/[0.03]')}>
              <span className="t-num text-[1.125rem] font-semibold text-ink">{n}</span>
              <span className="flex items-center gap-1 text-[0.75rem] text-ink-muted">
                {i > 1 ? <ChevronRight className="h-3 w-3 text-ink-faint" aria-hidden /> : null}
                {v === 'all' ? 'All sources' : SOURCE_STATUS.find((x) => x.value === v)?.label}
              </span>
            </button>
          );
        })}
      </div>
      <SourceTable sources={shown} studies={studies} />
    </div>
  );
}

function SourceTable({ sources, studies, compact }: { sources: Source[]; studies: Study[]; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...sources].filter((s) => !needle || [s.title, s.authors, s.findings, s.themes.join(' ')].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || (b.year ?? 0) - (a.year ?? 0));
  }, [sources, q]);
  const current = sources.find((s) => s.id === open);
  if (sources.length === 0) return <EmptyState size="sm" title="No sources yet" description="Paste a reference (APA/MLA) or a DOI — the fields are filled in for you." />;
  return (
    <>
      {!compact ? <Input className="mb-3 max-w-sm" placeholder="Search title, author, finding, theme" value={q} onChange={(e) => setQ(e.target.value)} /> : null}
      <div className="overflow-x-auto rounded-xl bg-surface-raised">
        <table className="w-full min-w-[46rem] text-left text-[0.8125rem]">
          <thead className="text-ink-faint">
            <tr className="border-b border-line-faint">
              <th className="px-4 py-2 font-normal">Source</th>
              <th className="px-2 py-2 font-normal">Status</th>
              <th className="px-2 py-2 font-normal">Method</th>
              <th className="px-2 py-2 font-normal">Key finding</th>
              <th className="px-2 py-2 font-normal">Themes</th>
              <th className="px-4 py-2 text-right font-normal">Rel.</th>
            </tr>
          </thead>
          <tbody className="[&>tr+tr]:border-t [&>tr+tr]:border-line-faint">
            {shown.map((s) => (
              <tr key={s.id} className="cursor-pointer align-top hover:bg-surface-sunken/50" onClick={() => setOpen(s.id)}>
                <td className="max-w-[18rem] px-4 py-2.5">
                  <div className="line-clamp-2 text-[0.875rem] text-ink">{s.title}</div>
                  <div className="truncate text-ink-faint">{[s.authors, s.year].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <Select aria-label="Status" className="h-7 w-[6.5rem] text-xs" value={s.status} onChange={(e) => void updateSource(s.id, { status: e.target.value as SourceStatus })}>
                    {SOURCE_STATUS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                  </Select>
                </td>
                <td className="max-w-[9rem] px-2 py-2.5 text-ink-muted"><span className="line-clamp-2">{s.method || '—'}</span></td>
                <td className="max-w-[16rem] px-2 py-2.5 text-ink-muted"><span className="line-clamp-2">{s.findings || '—'}</span></td>
                <td className="max-w-[10rem] px-2 py-2.5 text-ink-muted"><span className="line-clamp-2">{s.themes.join(', ') || '—'}</span></td>
                <td className="px-4 py-2.5 text-right tabular text-ink-muted">{s.relevance ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current ? <SourceSheet source={current} studies={studies} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function SourceSheet({ source, studies, defaultStudyId, onClose }: { source?: Source; studies: Study[]; defaultStudyId?: string; onClose: () => void }) {
  const allStudies = useLiveQuery(() => db.studies.toArray(), []) ?? studies;
  const [paste, setPaste] = useState('');
  const [f, setF] = useState<Partial<Source>>(source ?? { studyIds: defaultStudyId ? [defaultStudyId] : [], themes: [], status: 'to_read' });
  const set = (patch: Partial<Source>) => setF((x) => ({ ...x, ...patch }));
  const themesFor = allStudies.filter((s) => f.studyIds?.includes(s.id)).flatMap((s) => s.themes);

  const save = async () => {
    if (!f.title?.trim()) return;
    if (source) await updateSource(source.id, f);
    else await createSource({ ...f, title: f.title });
    toast.success(source ? 'Source updated' : 'Source added');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={source ? 'Source' : 'Add source'} size="lg"
      footer={(
        <div className="flex w-full justify-between">
          {source ? <Button variant="ghost" className="text-critical" onClick={() => void deleteSource(source.id).then(onClose)}>Delete</Button> : <span />}
          <div className="flex gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title?.trim()} onClick={() => void save()}>Save</Button></div>
        </div>
      )}>
      <div className="space-y-4">
        {!source ? (
          <Field label="Paste a reference" hint="APA-style “Author (Year). Title. Venue.” and DOIs/URLs are recognised.">
            <div className="flex gap-2">
              <Input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Smith, J. (2021). Title. Journal. https://doi.org/…" />
              <Button disabled={!paste.trim()} onClick={() => setF((x) => ({ ...x, ...parseReference(paste) }))}>Fill</Button>
            </div>
          </Field>
        ) : null}
        <Field label="Title" required><Input value={f.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_6rem_8rem]">
          <Field label="Authors"><Input value={f.authors ?? ''} onChange={(e) => set({ authors: e.target.value })} /></Field>
          <Field label="Year"><Input inputMode="numeric" value={f.year ?? ''} onChange={(e) => set({ year: Number(e.target.value) || undefined })} /></Field>
          <Field label="Relevance"><Select value={f.relevance ?? ''} onChange={(e) => set({ relevance: Number(e.target.value) || undefined })}><option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</Select></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue"><Input value={f.venue ?? ''} onChange={(e) => set({ venue: e.target.value })} /></Field>
          <Field label="DOI or URL"><Input value={f.doi ?? f.url ?? ''} onChange={(e) => (e.target.value.startsWith('10.') ? set({ doi: e.target.value }) : set({ url: e.target.value }))} /></Field>
        </div>
        <Field label="Used in">
          <div className="flex flex-wrap gap-1.5">
            {allStudies.map((s) => {
              const on = f.studyIds?.includes(s.id);
              return (
                <button key={s.id} type="button" aria-pressed={on}
                  onClick={() => set({ studyIds: on ? f.studyIds!.filter((x) => x !== s.id) : [...(f.studyIds ?? []), s.id] })}
                  className={cn('h-8 rounded-full px-3 text-[0.8125rem]', on ? 'bg-accent text-accent-contrast' : 'bg-surface-sunken text-ink-muted')}>{s.title}</button>
              );
            })}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Method"><Textarea rows={2} value={f.method ?? ''} onChange={(e) => set({ method: e.target.value })} /></Field>
          <Field label="Sample / data"><Textarea rows={2} value={f.sample ?? ''} onChange={(e) => set({ sample: e.target.value })} /></Field>
          <Field label="Key findings"><Textarea rows={3} value={f.findings ?? ''} onChange={(e) => set({ findings: e.target.value })} /></Field>
          <Field label="Limitations"><Textarea rows={3} value={f.limitations ?? ''} onChange={(e) => set({ limitations: e.target.value })} /></Field>
        </div>
        <Field label="Themes">
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...themesFor, ...(f.themes ?? [])])].map((t) => {
              const on = f.themes?.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on}
                  onClick={() => set({ themes: on ? f.themes!.filter((x) => x !== t) : [...(f.themes ?? []), t] })}
                  className={cn('h-8 rounded-full px-3 text-[0.8125rem]', on ? 'bg-accent-soft text-accent-ink' : 'bg-surface-sunken text-ink-muted')}>{t}</button>
              );
            })}
            <Input className="h-8 w-36 text-xs" placeholder="New theme ↵" onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const v = e.currentTarget.value.trim();
              if (v) { set({ themes: [...new Set([...(f.themes ?? []), v])] }); e.currentTarget.value = ''; }
            }} />
          </div>
        </Field>
        <Field label="Status">
          <SegmentedControl aria-label="Status" size="sm" value={(f.status ?? 'to_read') as SourceStatus} onChange={(v) => set({ status: v })} items={SOURCE_STATUS} />
        </Field>
      </div>
    </Modal>
  );
}

function NewStudySheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const trackers = useLiveQuery(() => db.trackers.filter((t) => !t.archived).toArray(), []) ?? [];
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<StudyKind>('literature_review');
  const [question, setQuestion] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [trackerId, setTrackerId] = useState('');
  const save = async () => {
    const s = await createStudy({ title, kind, question: question || undefined, targetDate: targetDate || null, trackerId: trackerId || trackers[0]?.id });
    onClose();
    onCreated(s.id);
  };
  return (
    <Modal open onClose={onClose} title="New study" size="md"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim()} onClick={() => void save()}>Create</Button></div>}>
      <div className="space-y-4">
        <Field label="Title" required><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Type">
          <SegmentedControl aria-label="Type" fullWidth value={kind} onChange={setKind}
            items={[{ value: 'literature_review', label: 'Literature review' }, { value: 'paper', label: 'Research paper' }, { value: 'experiment', label: 'Experiment' }]} />
        </Field>
        <Field label="Research question"><Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target date"><Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></Field>
          <Field label="Counts toward"><Select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>{trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        </div>
        <p className="text-[0.8125rem] text-ink-muted">The manuscript sections are pre-filled for the type you pick; edit them any time.</p>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* Skills                                                              */
/* ================================================================== */

export function SkillsPage() {
  const skills = useLiveQuery(() => db.skills.orderBy('sortOrder').toArray(), []) ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const categories = [...new Set(skills.map((s) => s.category))];
  const current = skills.find((s) => s.id === open);
  const evidence = skills.reduce((n, s) => n + s.evidence.length, 0);
  const atTarget = skills.filter((s) => skillGap(s) === 0).length;

  return (
    <Page title="Skills" subtitle="Where you are, where you're heading, and the proof — labs, projects, certificates."
      actions={<Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New skill</Button>}>
      {skills.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No skills tracked" description="Add the skills your goals depend on, then attach evidence as you earn it."
          action={<Button variant="primary" onClick={() => setCreating(true)}>New skill</Button>} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-xl">
            <MetricTile label="Skills" value={skills.length} />
            <MetricTile label="At target" value={`${atTarget}/${skills.length}`} tone={atTarget === skills.length ? 'positive' : 'default'} />
            <MetricTile label="Evidence" value={evidence} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {categories.map((cat) => (
              <InsetGroup key={cat} header={cat}>
                {skills.filter((s) => s.category === cat).map((s) => (
                  <Row key={s.id} chevron onClick={() => setOpen(s.id)} title={s.name}
                    subtitle={`${SKILL_LEVELS[s.level]} → ${SKILL_LEVELS[s.targetLevel]} · ${s.evidence.length} evidence`}
                    trailing={<LevelDots level={s.level} target={s.targetLevel} />} />
                ))}
              </InsetGroup>
            ))}
          </div>
        </>
      )}
      {current ? <SkillSheet skill={current} onClose={() => setOpen(null)} /> : null}
      {creating ? <NewSkillSheet categories={categories} onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}

function LevelDots({ level, target }: { level: number; target: number }) {
  return (
    <span className="flex gap-1" aria-label={`Level ${level} of 5, target ${target}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('h-2 w-2 rounded-full', i <= level ? 'bg-accent' : i <= target ? 'border border-accent/60' : 'bg-surface-sunken')} />
      ))}
    </span>
  );
}

function SkillSheet({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [ev, setEv] = useState<{ title: string; kind: SkillEvidence['kind']; url: string }>({ title: '', kind: 'project', url: '' });
  const [step, setStep] = useState('');
  return (
    <Modal open onClose={onClose} title={skill.name} description={skill.category} size="lg"
      footer={<div className="flex w-full justify-between"><Button variant="ghost" className="text-critical" onClick={() => void deleteSkill(skill.id).then(onClose)}>Delete</Button><Button variant="primary" onClick={onClose}>Done</Button></div>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current level">
            <Select value={skill.level} onChange={(e) => void updateSkill(skill.id, { level: Number(e.target.value) as SkillLevel })}>
              {SKILL_LEVELS.map((l, i) => <option key={l} value={i}>{i} · {l}</option>)}
            </Select>
          </Field>
          <Field label="Target level">
            <Select value={skill.targetLevel} onChange={(e) => void updateSkill(skill.id, { targetLevel: Number(e.target.value) as SkillLevel })}>
              {SKILL_LEVELS.map((l, i) => <option key={l} value={i}>{i} · {l}</option>)}
            </Select>
          </Field>
        </div>
        <InsetGroup header="Learning path">
          {skill.path.map((p) => (
            <Row key={p.id} leading={<CheckCircle checked={!!p.doneAt} label={p.title} onToggle={() => void toggleSkillPathItem(skill.id, p.id)} />}
              title={<span className={p.doneAt ? 'text-ink-faint line-through' : undefined}>{p.title}</span>}
              trailing={p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="text-[0.8125rem] text-accent-ink">Open</a> : undefined} />
          ))}
          <form className="px-4 py-2" onSubmit={(e) => { e.preventDefault(); if (step.trim()) void updateSkill(skill.id, { path: [...skill.path, { id: newId('stp'), title: step.trim(), doneAt: null }] }).then(() => setStep('')); }}>
            <Input value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a course, book or lab" />
          </form>
        </InsetGroup>
        <InsetGroup header="Evidence" footer="Proof that the level is real: labs, write-ups, shipped projects, certificates.">
          {skill.evidence.map((e) => (
            <Row key={e.id} title={e.title} subtitle={`${e.kind.replace('_', ' ')} · ${formatDateKeyShort(e.date)}`}
              trailing={(
                <>
                  {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="text-[0.8125rem] text-accent-ink">Open</a> : null}
                  <IconButton label="Remove" size="xs" variant="ghost" onClick={() => void updateSkill(skill.id, { evidence: skill.evidence.filter((x) => x.id !== e.id) })}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                </>
              )} />
          ))}
          <form className="flex flex-wrap gap-2 px-4 py-2" onSubmit={(e) => {
            e.preventDefault();
            if (!ev.title.trim()) return;
            void addSkillEvidence(skill.id, { title: ev.title.trim(), kind: ev.kind, url: ev.url || undefined, date: todayKey() }).then(() => setEv({ title: '', kind: ev.kind, url: '' }));
          }}>
            <Input className="min-w-[12rem] flex-1" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} placeholder="What did you build or complete?" />
            <Select aria-label="Kind" className="w-36" value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value as SkillEvidence['kind'] })}>
              {(['project', 'lab', 'course', 'certificate', 'problem_set', 'writeup', 'assessment', 'other'] as const).map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
            </Select>
            <Input className="w-48" value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })} placeholder="Link (optional)" />
            <Button type="submit" variant="secondary" disabled={!ev.title.trim()}>Add</Button>
          </form>
        </InsetGroup>
        <Field label="Notes"><Textarea rows={3} defaultValue={skill.notes ?? ''} onBlur={(e) => void updateSkill(skill.id, { notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function NewSkillSheet({ categories, onClose }: { categories: string[]; onClose: () => void }) {
  const trackers = useLiveQuery(() => db.trackers.filter((t) => !t.archived).toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'Cybersecurity');
  const [level, setLevel] = useState<SkillLevel>(1);
  const [target, setTarget] = useState<SkillLevel>(3);
  const [trackerId, setTrackerId] = useState('');
  return (
    <Modal open onClose={onClose} title="New skill" size="md"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()}
        onClick={() => void createSkill({ name, category: category.trim() || 'General', level, targetLevel: target, trackerId: trackerId || null }).then(onClose)}>Add</Button></div>}>
      <div className="space-y-4">
        <Field label="Skill" required><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Network security" /></Field>
        <Field label="Category"><Input list="skill-cats" value={category} onChange={(e) => setCategory(e.target.value)} /><datalist id="skill-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Now"><Select value={level} onChange={(e) => setLevel(Number(e.target.value) as SkillLevel)}>{SKILL_LEVELS.map((l, i) => <option key={l} value={i}>{l}</option>)}</Select></Field>
          <Field label="Target"><Select value={target} onChange={(e) => setTarget(Number(e.target.value) as SkillLevel)}>{SKILL_LEVELS.map((l, i) => <option key={l} value={i}>{l}</option>)}</Select></Field>
          <Field label="Practice tracker"><Select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}><option value="">None</option>{trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        </div>
      </div>
    </Modal>
  );
}
