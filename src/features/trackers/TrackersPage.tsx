import { useMemo, useState } from 'react';
import { Archive, Plus, Trash2 } from 'lucide-react';
import { Page, PageSection } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Badge, Dot } from '@/components/ui/Badge';
import { PILLAR_LABELS, TRACKER_COLORS } from '@/config/trackers';
import { useTrackers } from '@/state/useLiveData';
import { createTracker, deleteTracker, updateTracker } from '@/services/trackerService';
import { toast } from '@/state/toastStore';
import { formatDuration } from '@/lib/date';
import type { Pillar, Tracker, TrackerColor } from '@/types';

const PILLARS: Pillar[] = ['study', 'fitness', 'skills', 'personal', 'system'];

export function TrackersPage() {
  const trackers = useTrackers(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Tracker | null>(null);
  const [creating, setCreating] = useState(false);

  const grouped = useMemo(() => {
    const visible = trackers.filter((t) => showArchived || !t.archived);
    const map = new Map<Pillar, Tracker[]>();
    for (const p of PILLARS) map.set(p, []);
    for (const t of visible) map.get(t.pillar)?.push(t);
    return map;
  }, [trackers, showArchived]);

  const childrenOf = useMemo(() => {
    const m = new Map<string, Tracker[]>();
    for (const t of trackers) {
      if (!t.parentId) continue;
      const list = m.get(t.parentId) ?? [];
      list.push(t);
      m.set(t.parentId, list);
    }
    return m;
  }, [trackers]);

  return (
    <Page
      title="Trackers"
      subtitle="Pillars and the subjects beneath them. Every task, block, session and activity belongs to exactly one tracker."
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
          <Button size="sm" variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New tracker
          </Button>
        </>
      }
    >
      {PILLARS.map((pillar) => {
        const roots = (grouped.get(pillar) ?? []).filter((t) => !t.parentId);
        if (!roots.length) return null;
        return (
          <PageSection key={pillar} title={PILLAR_LABELS[pillar]}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {roots.map((tracker) => (
                <TrackerCard
                  key={tracker.id}
                  tracker={tracker}
                  subs={childrenOf.get(tracker.id) ?? []}
                  onEdit={() => setEditing(tracker)}
                />
              ))}
            </div>
          </PageSection>
        );
      })}

      {!trackers.length && (
        <EmptyState title="No trackers yet" description="Trackers are seeded automatically on first run." />
      )}

      <TrackerDialog
        open={creating || !!editing}
        tracker={editing}
        parents={trackers.filter((t) => !t.parentId && !t.archived)}
        onClose={() => { setCreating(false); setEditing(null); }}
      />
    </Page>
  );
}

function TrackerCard({ tracker, subs, onEdit }: { tracker: Tracker; subs: Tracker[]; onEdit: () => void }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <button className="flex min-w-0 items-center gap-2 text-left" onClick={onEdit}>
          <Dot color={tracker.color} />
          <span className="truncate text-sm font-medium text-ink">{tracker.name}</span>
        </button>
        <div className="flex items-center gap-1">
          {tracker.archived ? <Badge tone="neutral">Archived</Badge> : null}
          {tracker.defaultProtected ? <Badge tone="caution">Protected</Badge> : null}
          {!tracker.system && (
            <IconButton
              label="Delete tracker"
              size="xs"
              onClick={async () => {
                const res = await deleteTracker(tracker.id);
                if (res.deleted) toast.success('Tracker deleted');
                else toast.warning('Tracker archived', res.reason);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          )}
          {tracker.system && !tracker.archived && (
            <IconButton
              label="Archive tracker"
              size="xs"
              onClick={async () => { await updateTracker(tracker.id, { archived: true }); toast.show('Tracker archived'); }}
            >
              <Archive className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      {tracker.weeklyTargetMinutes ? (
        <div className="t-meta mt-1">Weekly target {formatDuration(tracker.weeklyTargetMinutes)}</div>
      ) : null}

      {subs.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {subs.map((child) => (
            <li key={child.id} className="flex items-center gap-2 text-xs text-ink-muted">
              <Dot color={child.color} className="h-1.5 w-1.5" />
              <span className="truncate">{child.name}</span>
              {child.archived ? <span className="text-ink-faint">(archived)</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TrackerDialog({
  open, tracker, parents, onClose,
}: {
  open: boolean;
  tracker: Tracker | null;
  parents: Tracker[];
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [pillar, setPillar] = useState<Pillar>('study');
  const [parentId, setParentId] = useState<string>('');
  const [color, setColor] = useState<TrackerColor>('indigo');
  const [weekly, setWeekly] = useState('');
  const [archived, setArchived] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Sync form state when the dialog target changes.
  const key = tracker?.id ?? (open ? 'new' : null);
  if (open && seeded !== key) {
    setSeeded(key);
    setName(tracker?.name ?? '');
    setPillar(tracker?.pillar ?? 'study');
    setParentId(tracker?.parentId ?? '');
    setColor(tracker?.color ?? 'indigo');
    setWeekly(tracker?.weeklyTargetMinutes ? String(tracker.weeklyTargetMinutes) : '');
    setArchived(tracker?.archived ?? false);
  }
  if (!open && seeded !== null) setSeeded(null);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Name is required'); return; }
    const weeklyTargetMinutes = weekly.trim() ? Math.max(0, Number(weekly)) : undefined;
    if (tracker) {
      await updateTracker(tracker.id, {
        name: trimmed, pillar, parentId: parentId || null, color, weeklyTargetMinutes, archived,
      });
      toast.success('Tracker updated');
    } else {
      await createTracker({ name: trimmed, pillar, parentId: parentId || null, color, weeklyTargetMinutes });
      toast.success('Tracker created');
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tracker ? 'Edit tracker' : 'New tracker'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>{tracker ? 'Save' : 'Create'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Physics" autoFocus />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pillar">
            <Select value={pillar} onChange={(e) => setPillar(e.target.value as Pillar)}>
              {PILLARS.map((p) => <option key={p} value={p}>{PILLAR_LABELS[p]}</option>)}
            </Select>
          </Field>
          <Field label="Parent tracker" hint="Leave empty to create a top-level tracker.">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">None</option>
              {parents.filter((p) => p.id !== tracker?.id).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {TRACKER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-lg border-2 transition ${color === c ? 'border-accent' : 'border-transparent'}`}
              >
                <Dot color={c} className="h-4 w-4" />
              </button>
            ))}
          </div>
        </Field>

        <Field label="Weekly target (minutes)" hint="Optional. Used by analytics to show target attainment.">
          <Input type="number" min={0} step={15} value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder="e.g. 600" />
        </Field>

        {tracker ? (
          <Field label="Archived" hint="Archived trackers stay attached to history but are hidden from pickers.">
            <Select value={archived ? 'yes' : 'no'} onChange={(e) => setArchived(e.target.value === 'yes')}>
              <option value="no">Active</option>
              <option value="yes">Archived</option>
            </Select>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
