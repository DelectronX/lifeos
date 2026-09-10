import { useMemo, useState } from 'react';
import { ArrowRight, Lock, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration, formatTime, MINUTE_MS } from '@/lib/date';
import { Checkbox } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import type { PlanEntry, ProposedBlock, UnplacedTask } from '@/types/scheduling';
import type { TaskPlacement } from '@/engines/scheduling';
import type { ScheduleBlock } from '@/types';

/**
 * Before/after schedule preview.
 *
 * The whole point of this component is that no automated change ever lands
 * without the user having seen exactly what it does and why. It renders two
 * columns — CURRENT PLAN and PROPOSED PLAN — with a per-row reason, and lets
 * the user deselect individual proposals before accepting ("Edit").
 */

export interface ImpactPreviewProps {
  /** Blocks already on the affected days. */
  existing: readonly ScheduleBlock[];
  /** Proposals the engine wants to add. */
  proposals: readonly ProposedBlock[];
  /** Per-task rationale from the engine. */
  placements?: readonly TaskPlacement[];
  unplaced?: readonly UnplacedTask[];
  /** Selected tempIds; omit for a read-only preview. */
  selected?: ReadonlySet<string>;
  onToggle?: (tempId: string) => void;
  className?: string;
}

interface Row {
  key: string;
  title: string;
  start: number;
  end: number;
  kind: 'existing' | 'proposed';
  locked: boolean;
  protected: boolean;
  reason?: string;
  tempId?: string;
}

export function ImpactPreview({
  existing, proposals, placements, unplaced, selected, onToggle, className,
}: ImpactPreviewProps) {
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const p of proposals) set.add(p.date);
    // Only show existing days that the plan actually touches.
    return [...set].sort();
  }, [proposals]);

  const currentRows = useMemo<Row[]>(
    () =>
      existing
        .filter((b) => dates.includes(b.date) && b.status !== 'cancelled')
        .map((b) => ({
          key: b.id,
          title: b.title,
          start: b.start,
          end: b.end,
          kind: 'existing' as const,
          locked: b.locked,
          protected: b.protected,
        }))
        .sort((a, b) => a.start - b.start),
    [existing, dates],
  );

  const proposedRows = useMemo<Row[]>(() => {
    const active = selected
      ? proposals.filter((p) => selected.has(p.tempId))
      : proposals;
    return [
      ...currentRows,
      ...active.map((p) => ({
        key: p.tempId,
        tempId: p.tempId,
        title: p.title,
        start: p.start,
        end: p.end,
        kind: 'proposed' as const,
        locked: p.locked,
        protected: p.protected,
        reason: p.reason,
      })),
    ].sort((a, b) => a.start - b.start);
  }, [currentRows, proposals, selected]);

  const addedMinutes = proposedRows
    .filter((r) => r.kind === 'proposed')
    .reduce((s, r) => s + (r.end - r.start) / MINUTE_MS, 0);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <PlanColumn
          label="Current plan"
          caption={`${currentRows.length} block${currentRows.length === 1 ? '' : 's'} already scheduled`}
          rows={currentRows}
        />
        <PlanColumn
          label="Proposed plan"
          caption={`+${formatDuration(addedMinutes)} in ${proposedRows.filter((r) => r.kind === 'proposed').length} new block(s)`}
          rows={proposedRows}
          highlight
          selected={selected}
          onToggle={onToggle}
        />
      </div>

      {placements && placements.length > 0 ? (
        <section>
          <h4 className="t-label mb-2">Why each task landed where it did</h4>
          <ul className="space-y-1.5">
            {placements.map((p) => (
              <li key={p.taskId} className="rounded-md border border-line bg-surface px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{p.title}</span>
                  <span className="t-num shrink-0 text-2xs text-ink-faint">
                    priority {Math.round(p.priorityScore)}/100 · {formatDuration(p.scheduledMinutes)}
                  </span>
                </div>
                <p className="t-meta mt-0.5">{p.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {unplaced && unplaced.length > 0 ? (
        <section>
          <h4 className="t-label mb-2">
            Could not be placed ({unplaced.length})
          </h4>
          <ul className="space-y-1.5">
            {unplaced.map((u) => (
              <li key={`${u.taskId}:${u.code}`} className="rounded-md border border-caution/30 bg-caution/5 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{u.title}</span>
                  {u.missingMinutes > 0 ? (
                    <span className="t-num shrink-0 text-2xs text-ink-faint">
                      {formatDuration(u.missingMinutes)} unplaced
                    </span>
                  ) : null}
                </div>
                <p className="t-meta mt-0.5">{u.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PlanColumn({
  label, caption, rows, highlight, selected, onToggle,
}: {
  label: string;
  caption: string;
  rows: readonly Row[];
  highlight?: boolean;
  selected?: ReadonlySet<string>;
  onToggle?: (tempId: string) => void;
}) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="border-b border-line px-3 py-2">
        <div className="t-label">{label}</div>
        <div className="t-meta mt-0.5">{caption}</div>
      </div>
      <ul className="max-h-72 divide-y divide-line overflow-y-auto">
        {rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-ink-faint">Nothing scheduled</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.key}
              className={cn(
                'px-3 py-2',
                row.kind === 'proposed' && highlight && 'bg-accent-soft/50',
              )}
            >
              <div className="flex items-start gap-2">
                {row.kind === 'proposed' && onToggle && row.tempId ? (
                  <Checkbox
                    checked={selected ? selected.has(row.tempId) : true}
                    onChange={() => onToggle(row.tempId!)}
                    className="mt-0.5"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-ink">{row.title}</span>
                    <span className="t-num shrink-0 text-2xs text-ink-muted">
                      {formatTime(row.start)}–{formatTime(row.end)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {row.protected ? (
                      <Badge tone="neutral"><Shield className="h-2.5 w-2.5" /> Protected</Badge>
                    ) : null}
                    {row.locked ? (
                      <Badge tone="neutral"><Lock className="h-2.5 w-2.5" /> Locked</Badge>
                    ) : null}
                    {row.kind === 'proposed' ? <Badge tone="accent">New</Badge> : null}
                  </div>
                  {row.reason ? <p className="t-meta mt-1">{row.reason}</p> : null}
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/**
 * Compact two-column diff for a conflict strategy, where both sides are
 * already-computed PlanEntry lists from the engine.
 */
export function PlanDiff({
  currentPlan, proposedPlan, className,
}: {
  currentPlan: readonly PlanEntry[];
  proposedPlan: readonly PlanEntry[];
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      <EntryColumn label="Current plan" entries={currentPlan} />
      <EntryColumn label="Proposed plan" entries={proposedPlan} highlightChanged />
    </div>
  );
}

function EntryColumn({
  label, entries, highlightChanged,
}: {
  label: string;
  entries: readonly PlanEntry[];
  highlightChanged?: boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="border-b border-line px-3 py-2 t-label">{label}</div>
      <ul className="max-h-64 divide-y divide-line overflow-y-auto">
        {entries.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-ink-faint">Day is empty</li>
        ) : (
          entries.map((e) => (
            <li
              key={`${e.blockId}-${e.start}`}
              className={cn('px-3 py-1.5', highlightChanged && e.changed && 'bg-accent-soft/60')}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-ink">{e.title}</span>
                <span className="t-num shrink-0 text-2xs text-ink-muted">
                  {formatTime(e.start)}–{formatTime(e.end)}
                </span>
              </div>
              {(e.protected || e.locked || (highlightChanged && e.changed)) && (
                <div className="mt-0.5 flex items-center gap-1.5">
                  {e.protected ? <Badge tone="neutral"><Shield className="h-2.5 w-2.5" /> Protected</Badge> : null}
                  {e.locked ? <Badge tone="neutral"><Lock className="h-2.5 w-2.5" /> Locked</Badge> : null}
                  {highlightChanged && e.changed ? <Badge tone="accent">Changed</Badge> : null}
                </div>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** Small before → after time chip used inside change lists. */
export function TimeShift({ from, to }: { from: { start: number; end: number }; to: { start: number; end: number } | null }) {
  return (
    <span className="t-num inline-flex items-center gap-1 text-2xs text-ink-muted">
      <span>{formatTime(from.start)}–{formatTime(from.end)}</span>
      <ArrowRight className="h-3 w-3 text-ink-faint" />
      {to ? <span className="text-ink">{formatTime(to.start)}–{formatTime(to.end)}</span> : <span className="text-critical">removed</span>}
    </span>
  );
}

/** Selection helper shared by the plan dialogs. */
export function useSelection(initial: readonly string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const reset = (ids: readonly string[]) => setSelected(new Set(ids));
  return { selected, toggle, reset, setSelected };
}
