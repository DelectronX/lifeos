import { useEffect, useState } from 'react';
import { Copy, LayoutTemplate, Plus, Trash2, Wand2 } from 'lucide-react';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Checkbox } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/state/toastStore';
import { useTemplates, useTrackers } from '@/state/useLiveData';
import {
  addTemplateEntry, applyTemplateToDays, copyTemplateDay, createTemplate, createTemplateFromDay,
  deleteTemplate, duplicateTemplate, removeTemplateEntry, updateTemplate, updateTemplateEntry,
} from '@/services/templateService';
import { addDaysToKey, dateKeyRange, formatMinute, weekdayName } from '@/lib/date';
import { KIND_LABELS } from './blockStyles';
import type { BlockKind, DateKey, ID, ScheduleTemplate } from '@/types';

const KINDS: BlockKind[] = ['fixed', 'task', 'break', 'buffer', 'sleep', 'meal', 'event'];

/**
 * Schedule template manager: create, edit entries, duplicate, delete, and apply
 * across a date range. Applying never locks the result — the stamped blocks are
 * ordinary editable blocks.
 */
export function TemplateManager({
  open, onClose, currentDate,
}: {
  open: boolean;
  onClose: () => void;
  currentDate: DateKey;
}) {
  const templates = useTemplates();
  const trackers = useTrackers();
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<ScheduleTemplate | null>(null);

  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;

  useEffect(() => {
    if (open && !selectedId && templates.length) setSelectedId(templates[0].id);
  }, [open, selectedId, templates]);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="xl"
        title="Schedule templates"
        description="Reusable weekly shapes you can stamp onto any days. Applied blocks stay fully editable."
        footer={<Button variant="ghost" onClick={onClose}>Done</Button>}
      >
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          {/* Template list */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New template name"
                onKeyDown={async (e) => {
                  if (e.key !== 'Enter' || !newName.trim()) return;
                  const t = await createTemplate(newName.trim());
                  setSelectedId(t.id); setNewName('');
                  toast.success('Template created');
                }}
              />
              <IconButton
                label="Create template"
                variant="primary"
                size="md"
                disabled={!newName.trim()}
                onClick={async () => {
                  const t = await createTemplate(newName.trim());
                  setSelectedId(t.id); setNewName('');
                  toast.success('Template created');
                }}
              >
                <Plus className="h-4 w-4" />
              </IconButton>
            </div>

            <Button
              fullWidth
              size="sm"
              iconLeft={<Wand2 className="h-3.5 w-3.5" />}
              onClick={async () => {
                const t = await createTemplateFromDay(`From ${currentDate}`, currentDate);
                setSelectedId(t.id);
                toast.success('Template captured', `${t.entries.length} entries from ${currentDate}.`);
              }}
            >
              Capture from {currentDate}
            </Button>

            <div className="max-h-72 space-y-1 overflow-y-auto">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={
                    selected?.id === t.id
                      ? 'flex w-full items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-2 text-left'
                      : 'flex w-full items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2 text-left hover:bg-surface-sunken'
                  }
                >
                  <span className="min-w-0 truncate text-sm text-ink">{t.name}</span>
                  <span className="t-meta t-num shrink-0">{t.entries.length}</span>
                </button>
              ))}
              {templates.length === 0 ? <div className="t-meta px-1 py-2">No templates yet.</div> : null}
            </div>
          </div>

          {/* Editor */}
          {selected ? (
            <TemplateEditor
              template={selected}
              trackers={trackers}
              currentDate={currentDate}
              onDuplicate={async () => {
                const copy = await duplicateTemplate(selected.id);
                if (copy) { setSelectedId(copy.id); toast.success('Template duplicated'); }
              }}
              onDelete={() => setDeleting(selected)}
            />
          ) : (
            <EmptyState
              icon={<LayoutTemplate className="h-8 w-8" />}
              title="No template selected"
              description="Create one on the left, or capture the current day's layout."
            />
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        confirmLabel="Delete template"
        title="Delete this template?"
        message={`"${deleting?.name}" will be removed. Blocks it already created stay on your schedule.`}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteTemplate(deleting.id);
          setSelectedId(null);
          toast.success('Template deleted');
          setDeleting(null);
        }}
      />
    </>
  );
}

function TemplateEditor({
  template, trackers, currentDate, onDuplicate, onDelete,
}: {
  template: ScheduleTemplate;
  trackers: ReturnType<typeof useTrackers>;
  currentDate: DateKey;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [applyFrom, setApplyFrom] = useState(currentDate);
  const [applyTo, setApplyTo] = useState(addDaysToKey(currentDate, 6));
  const [replace, setReplace] = useState(true);
  const [skipConflicts, setSkipConflicts] = useState(false);
  const [applying, setApplying] = useState(false);
  const [copyFrom, setCopyFrom] = useState(1);

  useEffect(() => { setName(template.name); }, [template.id, template.name]);

  const defaultTracker = trackers.find((t) => t.pillar !== 'system')?.id ?? trackers[0]?.id ?? '';

  const apply = async () => {
    if (applyTo < applyFrom) { toast.error('End date is before the start date'); return; }
    setApplying(true);
    try {
      const dates = dateKeyRange(applyFrom, applyTo);
      const res = await applyTemplateToDays(template.id, dates, { replaceExisting: replace, skipConflicts });
      toast.success(
        'Template applied',
        `${res.created} block${res.created === 1 ? '' : 's'} created across ${dates.length} day${dates.length === 1 ? '' : 's'}` +
          (res.replaced ? `, ${res.replaced} replaced` : '') +
          (res.skipped ? `, ${res.skipped} skipped for conflicts` : '') + '.',
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-end gap-2">
        <Field label="Template name" className="flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => {
            if (name.trim() && name !== template.name) void updateTemplate(template.id, { name: name.trim() });
          }} />
        </Field>
        <IconButton label="Duplicate template" size="md" onClick={onDuplicate}><Copy className="h-4 w-4" /></IconButton>
        <IconButton label="Delete template" size="md" variant="danger" onClick={onDelete}><Trash2 className="h-4 w-4" /></IconButton>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="t-label">Entries</div>
          <Button
            size="xs"
            iconLeft={<Plus className="h-3 w-3" />}
            onClick={async () => {
              await addTemplateEntry(template.id, {
                dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60,
                title: 'New entry', trackerId: defaultTracker, kind: 'fixed',
              });
            }}
          >
            Add entry
          </Button>
        </div>

        <div className="max-h-[18rem] space-y-1.5 overflow-y-auto rounded-lg border border-line p-2">
          {template.entries.length === 0 ? (
            <div className="t-meta px-1 py-3 text-center">No entries. Add one to describe a recurring slot.</div>
          ) : null}
          {[...template.entries]
            .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute)
            .map((entry) => (
              <div key={entry.id} className="grid grid-cols-[5rem_1fr] gap-2 rounded-md border border-line bg-surface-sunken p-2 sm:grid-cols-[5rem_1fr_7rem_5rem_5rem_2rem]">
                <Select
                  sizeVariant="sm"
                  value={String(entry.dayOfWeek)}
                  onChange={(e) => void updateTemplateEntry(template.id, entry.id, { dayOfWeek: Number(e.target.value) })}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{weekdayName(d, true)}</option>)}
                </Select>
                <Input
                  sizeVariant="sm"
                  value={entry.title}
                  onChange={(e) => void updateTemplateEntry(template.id, entry.id, { title: e.target.value })}
                />
                <Select
                  sizeVariant="sm"
                  value={entry.trackerId}
                  onChange={(e) => void updateTemplateEntry(template.id, entry.id, { trackerId: e.target.value })}
                >
                  {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <Input
                  sizeVariant="sm"
                  type="time"
                  step={300}
                  value={toHHMM(entry.startMinute)}
                  onChange={(e) => void updateTemplateEntry(template.id, entry.id, { startMinute: fromHHMM(e.target.value) })}
                />
                <Input
                  sizeVariant="sm"
                  type="time"
                  step={300}
                  value={toHHMM(entry.endMinute)}
                  onChange={(e) => void updateTemplateEntry(template.id, entry.id, { endMinute: fromHHMM(e.target.value) })}
                />
                <div className="flex items-center justify-end gap-1">
                  <Badge tone="outline">{KIND_LABELS[entry.kind]}</Badge>
                  <IconButton
                    label="Remove entry"
                    size="xs"
                    onClick={() => void removeTemplateEntry(template.id, entry.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
                <div className="col-span-full flex flex-wrap items-center gap-3 pl-0.5">
                  <Select
                    sizeVariant="sm"
                    className="w-28"
                    value={entry.kind}
                    onChange={(e) => void updateTemplateEntry(template.id, entry.id, { kind: e.target.value as BlockKind })}
                  >
                    {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                  </Select>
                  <Checkbox
                    checked={entry.protected}
                    onChange={(v) => void updateTemplateEntry(template.id, entry.id, { protected: v })}
                    label={<span className="text-2xs">Protected</span>}
                  />
                  <Checkbox
                    checked={entry.locked}
                    onChange={(v) => void updateTemplateEntry(template.id, entry.id, { locked: v })}
                    label={<span className="text-2xs">Locked</span>}
                  />
                  <span className="t-meta t-num ml-auto">
                    {formatMinute(entry.startMinute)} – {formatMinute(entry.endMinute)}
                  </span>
                </div>
              </div>
            ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2">
        <Field label="Copy day" className="w-28">
          <Select sizeVariant="sm" value={String(copyFrom)} onChange={(e) => setCopyFrom(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{weekdayName(d, true)}</option>)}
          </Select>
        </Field>
        <Button
          size="sm"
          onClick={async () => {
            const n = await copyTemplateDay(template.id, copyFrom, [1, 2, 3, 4, 5].filter((d) => d !== copyFrom));
            toast.success(n ? `Copied to weekdays (${n} entries)` : 'Nothing to copy from that day');
          }}
        >
          Copy to all weekdays
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border border-accent/20 bg-accent-soft/40 px-3 py-3">
        <div className="t-label">Apply to days</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><Input type="date" value={applyFrom} onChange={(e) => setApplyFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={applyTo} onChange={(e) => setApplyTo(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <Checkbox checked={replace} onChange={setReplace} label={<span className="text-xs">Replace this template&apos;s previous blocks</span>} />
          <Checkbox checked={skipConflicts} onChange={setSkipConflicts} label={<span className="text-xs">Skip slots that already have a block</span>} />
        </div>
        <Button variant="primary" size="sm" loading={applying} onClick={apply}>
          Apply to {dateKeyRange(applyFrom, applyTo <= applyFrom ? applyFrom : applyTo).length} day
          {dateKeyRange(applyFrom, applyTo <= applyFrom ? applyFrom : applyTo).length === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}

function toHHMM(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function fromHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
