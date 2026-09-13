import { useMemo, useState } from 'react';
import { AlertTriangle, Copy, Plus, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { Page, PageSection } from '@/components/layout/Page';
import { Card, PanelHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button, IconButton } from '@/components/ui/Button';
import { Select, Toggle } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { TrackerBadge } from '@/components/ui/Badge';
import { toast } from '@/state/toastStore';
import { formatMinute } from '@/lib/date';
import {
  createScheduleRule, deleteScheduleRule, detectRuleConflicts,
  duplicateScheduleRule, updateScheduleRule,
} from '@/services/scheduleRuleService';
import type { ScheduleRule, Tracker } from '@/types';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRIORITY_LABELS: Record<number, string> = {
  1: 'Lowest', 2: 'Low', 3: 'Normal', 4: 'High', 5: 'Highest',
};

function minutesOptions(): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [];
  for (let m = 0; m <= 1440; m += 15) out.push({ value: m, label: formatMinute(m % 1440) });
  return out;
}
const TIME_OPTIONS = minutesOptions();

/**
 * Auto Plan rule builder — subject/day/time-window/priority HARD constraints.
 *
 * Every rule created here is fed into `planSchedule` via
 * `scheduleRuleService.loadSubjectWindowRules`: a subject with an active
 * rule can NEVER be placed outside the union of its rules' windows. This
 * page is pure CRUD + conflict surfacing; the enforcement itself lives in
 * the engine.
 */
export function RuleBuilderPage() {
  const allTrackers = useLiveQuery(() => db.trackers.toArray(), []) ?? [];
  const trackers = useMemo(() => allTrackers.filter((t) => !t.archived), [allTrackers]);
  const rules = useLiveQuery(() => db.scheduleRules.toArray(), []) ?? [];
  const [creating, setCreating] = useState(false);

  const trackerById = useMemo(() => {
    const map = new Map<string, Tracker>();
    for (const t of allTrackers) map.set(t.id, t);
    return map;
  }, [allTrackers]);

  const conflicts = useMemo(() => detectRuleConflicts(rules), [rules]);
  const conflictsByTracker = useMemo(() => {
    const map = new Map<string, typeof conflicts>();
    for (const c of conflicts) {
      for (const id of c.trackerIds) {
        const list = map.get(id) ?? [];
        list.push(c);
        map.set(id, list);
      }
    }
    return map;
  }, [conflicts]);

  const eligibleTrackers = trackers.length > 0 ? trackers : allTrackers;

  return (
    <Page
      title="Auto Plan rules"
      subtitle="Constrain a subject to specific days and a time window. The planner will never schedule it outside these hours."
      actions={
        <Button
          variant="primary"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setCreating(true)}
          disabled={eligibleTrackers.length === 0}
        >
          New rule
        </Button>
      }
    >
      {conflicts.length > 0 ? (
        <PageSection>
          <div className="rounded-card border border-caution/30 bg-caution/5 px-3 py-2.5" role="status">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">
                  {conflicts.length} rule conflict{conflicts.length === 1 ? '' : 's'} found
                </div>
                <ul className="mt-1 space-y-0.5">
                  {conflicts.map((c, i) => (
                    <li key={i} className="t-meta">
                      {c.trackerIds.map((id) => trackerById.get(id)?.name ?? id).join(' vs ')}: {c.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </PageSection>
      ) : null}

      {eligibleTrackers.length === 0 ? (
        <EmptyState
          title="No subjects yet"
          description="Create a Tracker (subject) before defining an Auto Plan rule for it."
        />
      ) : rules.length === 0 && !creating ? (
        <EmptyState
          title="No rules yet"
          description="Add a rule to hard-lock a subject to specific days and hours — e.g. Mathematics, Mon-Fri, 4-6 PM."
          action={<Button onClick={() => setCreating(true)} iconLeft={<Plus className="h-4 w-4" />}>New rule</Button>}
        />
      ) : (
        <PageSection>
          <div className="space-y-3">
            {creating ? (
              <RuleEditor
                trackers={eligibleTrackers}
                onCancel={() => setCreating(false)}
                onSave={async (draft) => {
                  await createScheduleRule(draft);
                  setCreating(false);
                  toast.success('Rule created');
                }}
              />
            ) : null}
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                tracker={trackerById.get(rule.trackerId)}
                trackers={eligibleTrackers}
                conflicts={conflictsByTracker.get(rule.trackerId) ?? []}
              />
            ))}
          </div>
        </PageSection>
      )}
    </Page>
  );
}

function RuleRow({
  rule, tracker, trackers, conflicts,
}: {
  rule: ScheduleRule;
  tracker: Tracker | undefined;
  trackers: Tracker[];
  conflicts: ReturnType<typeof detectRuleConflicts>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <RuleEditor
        trackers={trackers}
        initial={rule}
        onCancel={() => setEditing(false)}
        onSave={async (draft) => {
          await updateScheduleRule(rule.id, draft);
          setEditing(false);
          toast.success('Rule updated');
        }}
      />
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {tracker ? <TrackerBadge color={tracker.color} name={tracker.name} /> : <Badge>Unknown subject</Badge>}
            <Badge tone={rule.active ? 'positive' : 'neutral'}>{rule.active ? 'Active' : 'Inactive'}</Badge>
            <Badge tone="outline">{PRIORITY_LABELS[rule.priority]} priority</Badge>
            {conflicts.length > 0 ? <Badge tone="caution">Conflict</Badge> : null}
          </div>
          <p className="t-meta mt-1.5">
            {rule.days.length === 0
              ? 'No days selected'
              : rule.days.slice().sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]).join(', ')}
            {' · '}
            {formatMinute(rule.startMinute)}–{formatMinute(rule.endMinute)}
            {' · sessions '}
            {rule.minSessionMinutes}–{rule.maxSessionMinutes} min
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Toggle
            checked={rule.active}
            onChange={(v) => void updateScheduleRule(rule.id, { active: v })}
          />
          <Button size="xs" onClick={() => setEditing(true)}>Edit</Button>
          <IconButton
            label="Duplicate rule"
            size="xs"
            onClick={async () => {
              await duplicateScheduleRule(rule.id);
              toast.success('Rule duplicated (inactive)');
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="Delete rule"
            size="xs"
            onClick={async () => {
              await deleteScheduleRule(rule.id);
              toast.success('Rule deleted');
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-critical" />
          </IconButton>
        </div>
      </div>
    </Card>
  );
}

interface RuleFormDraft {
  trackerId: string;
  days: number[];
  startMinute: number;
  endMinute: number;
  minSessionMinutes: number;
  maxSessionMinutes: number;
  priority: 1 | 2 | 3 | 4 | 5;
  active: boolean;
}

function RuleEditor({
  trackers, initial, onSave, onCancel,
}: {
  trackers: Tracker[];
  initial?: ScheduleRule;
  onSave: (draft: RuleFormDraft) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [trackerId, setTrackerId] = useState(initial?.trackerId ?? trackers[0]?.id ?? '');
  const [days, setDays] = useState<number[]>(initial?.days ?? [1, 2, 3, 4, 5]);
  const [startMinute, setStartMinute] = useState(initial?.startMinute ?? 16 * 60);
  const [endMinute, setEndMinute] = useState(initial?.endMinute ?? 18 * 60);
  const [minSessionMinutes, setMinSessionMinutes] = useState(initial?.minSessionMinutes ?? 20);
  const [maxSessionMinutes, setMaxSessionMinutes] = useState(initial?.maxSessionMinutes ?? 120);
  const [priority, setPriority] = useState<1 | 2 | 3 | 4 | 5>(initial?.priority ?? 3);
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  };

  const invalid = !trackerId || days.length === 0 || endMinute <= startMinute;

  return (
    <Card tone="outline">
      <PanelHeader title={initial ? 'Edit rule' : 'New rule'} />
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">Subject</span>
          <Select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>
            {trackers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">Days</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_SHORT.map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  days.includes(d)
                    ? 'border-accent bg-accent/12 text-accent-ink'
                    : 'border-line bg-surface-sunken text-ink-muted hover:border-line-strong'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">Start time</span>
            <Select value={String(startMinute)} onChange={(e) => setStartMinute(Number(e.target.value))}>
              {TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">End time</span>
            <Select value={String(endMinute)} onChange={(e) => setEndMinute(Number(e.target.value))}>
              {TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">Min session (min)</span>
            <Select value={String(minSessionMinutes)} onChange={(e) => setMinSessionMinutes(Number(e.target.value))}>
              {[10, 15, 20, 25, 30, 45, 60].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">Max session (min)</span>
            <Select value={String(maxSessionMinutes)} onChange={(e) => setMaxSessionMinutes(Number(e.target.value))}>
              {[30, 45, 60, 90, 120, 150, 180].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">Priority</span>
          <Select value={String(priority)} onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}>
            {([1, 2, 3, 4, 5] as const).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </Select>
        </label>

        <Toggle label="Active" description="Inactive rules are ignored by the planner." checked={active} onChange={setActive} />

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="primary"
            disabled={invalid || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  trackerId, days, startMinute, endMinute,
                  minSessionMinutes, maxSessionMinutes, priority, active,
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
        {invalid ? (
          <p className="t-meta text-critical">Pick at least one day and an end time after the start time.</p>
        ) : null}
      </div>
    </Card>
  );
}
