import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { formatDateKeyShort, todayKey } from '@/lib/date';
import { toast } from '@/state/toastStore';
import { useSchedulingConfig, useTrackers } from '@/state/useLiveData';
import { createRevisionPlan, previewRevisionSchedule } from '@/services/revisionService';
import type { GeneratedRevision } from '@/engines/revisionScheduling';

type Mode = 'default' | 'custom' | 'manual';

/**
 * Schedules the revision ladder for a completed learning unit. Three modes,
 * exactly as the engine supports them: the configured default template, a
 * custom interval ladder, or explicit manual dates.
 */
export function RevisionPlanDialog({ onClose }: { onClose: () => void }) {
  const trackers = useTrackers();
  const config = useSchedulingConfig();

  const [mode, setMode] = useState<Mode>('default');
  const [title, setTitle] = useState('');
  const [trackerId, setTrackerId] = useState('');
  const [startDate, setStartDate] = useState(todayKey());
  const [duration, setDuration] = useState(config.revision.defaultDurationMinutes);
  const [notes, setNotes] = useState('');
  const [intervalText, setIntervalText] = useState(config.revision.intervals.join(', '));
  const [manualDates, setManualDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState('');
  const [preview, setPreview] = useState<GeneratedRevision[]>([]);
  const [saving, setSaving] = useState(false);

  const selectable = useMemo(() => trackers.filter((t) => t.pillar !== 'system'), [trackers]);

  useEffect(() => {
    if (!trackerId && selectable.length) setTrackerId(selectable[0].id);
  }, [selectable, trackerId]);

  const customIntervals = useMemo(
    () =>
      intervalText
        .split(/[,\s]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    [intervalText],
  );

  const draft = useMemo(
    () => ({
      title: title.trim() || 'Untitled topic',
      trackerId,
      startDate,
      durationMinutes: duration,
      ...(mode === 'custom' ? { customIntervals } : {}),
      ...(mode === 'manual' ? { manualDates } : {}),
    }),
    [title, trackerId, startDate, duration, mode, customIntervals, manualDates],
  );

  useEffect(() => {
    let cancelled = false;
    void previewRevisionSchedule(draft).then((rows) => {
      if (!cancelled) setPreview(rows);
    });
    return () => { cancelled = true; };
  }, [draft]);

  const valid = title.trim().length > 0 && trackerId.length > 0 && preview.length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const result = await createRevisionPlan({ ...draft, title: title.trim(), notes: notes.trim() || undefined });
      toast.success('Revision plan created', result.explanation);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Schedule revisions"
      description="Pick the material you just learnt. The ladder is anchored on the day you learnt it, not on today."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!valid} onClick={() => void save()}>
            Schedule {preview.length} revision{preview.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Topic" required className="sm:col-span-2">
            <Input
              autoFocus
              value={title}
              placeholder="e.g. Rotational dynamics — torque and angular momentum"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Subject" required>
            <Select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>
              {selectable.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Learnt on" hint="The ladder counts forward from this day.">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Minutes per revision">
            <Input
              type="number"
              min={5}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Math.max(5, Number(e.target.value) || 5))}
            />
          </Field>
        </div>

        <div>
          <Tabs
            variant="pill"
            size="sm"
            value={mode}
            onChange={setMode}
            items={[
              { value: 'default', label: 'Default ladder' },
              { value: 'custom', label: 'Custom intervals' },
              { value: 'manual', label: 'Manual dates' },
            ]}
          />

          <div className="mt-3">
            {mode === 'default' ? (
              <p className="t-muted">
                Uses your configured intervals: {config.revision.intervals.join(', ')} days after the learning date.
                Change the defaults in Settings.
              </p>
            ) : mode === 'custom' ? (
              <Field
                label="Intervals in days"
                hint="Comma separated. Duplicates are removed and the list is sorted ascending."
              >
                <Input value={intervalText} onChange={(e) => setIntervalText(e.target.value)} />
              </Field>
            ) : (
              <div>
                <div className="flex items-end gap-2">
                  <Field label="Add a revision date" className="flex-1">
                    <Input type="date" value={newDate} min={startDate} onChange={(e) => setNewDate(e.target.value)} />
                  </Field>
                  <Button
                    variant="secondary"
                    iconLeft={<Plus className="h-4 w-4" />}
                    disabled={!newDate || manualDates.includes(newDate)}
                    onClick={() => { setManualDates((d) => [...d, newDate].sort()); setNewDate(''); }}
                  >
                    Add
                  </Button>
                </div>
                {manualDates.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {manualDates.map((d) => (
                      <span key={d} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs">
                        {formatDateKeyShort(d)}
                        <IconButton
                          size="xs"
                          label={`Remove ${d}`}
                          onClick={() => setManualDates((list) => list.filter((x) => x !== d))}
                        >
                          <X className="h-3 w-3" />
                        </IconButton>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="t-meta mt-2">No dates yet — add at least one.</p>
                )}
              </div>
            )}
          </div>
        </div>

        <Field label="Notes" hint="Optional. Shown on the plan.">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="rounded-lg border border-line bg-surface-sunken/40 p-3">
          <div className="t-label mb-2">Schedule preview</div>
          {preview.length === 0 ? (
            <p className="t-meta">Nothing to schedule with the current settings.</p>
          ) : (
            <ol className="space-y-1.5">
              {preview.map((g) => (
                <li key={g.repetition} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="t-num w-6 shrink-0 text-xs text-ink-faint">#{g.repetition + 1}</span>
                  <span className="text-sm font-medium text-ink">{formatDateKeyShort(g.dueDate)}</span>
                  <span className="t-meta">{g.reason}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}
