import { Search, X } from 'lucide-react';
import { Input, Select } from '@/components/ui/Input';
import { Button, IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { STATUS_LABELS, type DateScope, type TaskFilter, type TaskGroupBy, type TaskSortBy, isFilterActive } from '@/services/taskQuery';
import type { Goal, TaskStatus, Tracker } from '@/types';

const DATE_SCOPES: { value: DateScope; label: string }[] = [
  { value: 'all', label: 'Any date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'undated', label: 'No date' },
];

const ALL_STATUSES: TaskStatus[] = [
  'inbox', 'planned', 'in_progress', 'completed', 'skipped', 'rescheduled', 'cancelled',
];

export function TaskFilterBar({
  filter, onChange, groupBy, onGroupBy, sortBy, onSortBy, trackers, goals, tags, resultCount,
}: {
  filter: TaskFilter;
  onChange: (f: TaskFilter) => void;
  groupBy: TaskGroupBy;
  onGroupBy: (g: TaskGroupBy) => void;
  sortBy: TaskSortBy;
  onSortBy: (s: TaskSortBy) => void;
  trackers: Tracker[];
  goals: Goal[];
  tags: string[];
  resultCount: number;
}) {
  const set = <K extends keyof TaskFilter>(key: K, value: TaskFilter[K]) =>
    onChange({ ...filter, [key]: value });

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={filter.search}
            onChange={(e) => set('search', e.target.value)}
            placeholder="Search title, notes, topic, tags…"
            className="pl-8"
          />
          {filter.search ? (
            <IconButton
              label="Clear search"
              size="xs"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => set('search', '')}
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
        </div>

        <Select
          value={filter.dateScope}
          onChange={(e) => set('dateScope', e.target.value as DateScope)}
          className="w-auto min-w-[8.5rem]"
        >
          {DATE_SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>

        <Select value={groupBy} onChange={(e) => onGroupBy(e.target.value as TaskGroupBy)} className="w-auto min-w-[9rem]">
          <option value="none">No grouping</option>
          <option value="due">Group: date</option>
          <option value="status">Group: status</option>
          <option value="tracker">Group: tracker</option>
          <option value="goal">Group: goal</option>
          <option value="priority">Group: priority</option>
          <option value="type">Group: type</option>
        </Select>

        <Select value={sortBy} onChange={(e) => onSortBy(e.target.value as TaskSortBy)} className="w-auto min-w-[8.5rem]">
          <option value="smart">Sort: smart</option>
          <option value="due">Sort: due date</option>
          <option value="priority">Sort: priority</option>
          <option value="created">Sort: newest</option>
          <option value="estimate">Sort: longest</option>
          <option value="title">Sort: A–Z</option>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChipGroup label="Tracker">
          {trackers.map((t) => (
            <Chip
              key={t.id}
              active={filter.trackerIds.includes(t.id)}
              onClick={() => set('trackerIds', toggleIn(filter.trackerIds, t.id))}
            >
              {t.name}
            </Chip>
          ))}
        </FilterChipGroup>

        <FilterChipGroup label="Priority">
          {[5, 4, 3, 2, 1].map((p) => (
            <Chip
              key={p}
              active={filter.priorities.includes(p)}
              onClick={() => set('priorities', toggleIn(filter.priorities, p))}
            >
              P{p}
            </Chip>
          ))}
        </FilterChipGroup>

        <FilterChipGroup label="Status">
          {ALL_STATUSES.map((s) => (
            <Chip
              key={s}
              active={filter.statuses.includes(s)}
              onClick={() => set('statuses', toggleIn(filter.statuses, s))}
            >
              {STATUS_LABELS[s]}
            </Chip>
          ))}
        </FilterChipGroup>

        {goals.length > 0 ? (
          <FilterChipGroup label="Goal">
            {goals.slice(0, 12).map((g) => (
              <Chip
                key={g.id}
                active={filter.goalIds.includes(g.id)}
                onClick={() => set('goalIds', toggleIn(filter.goalIds, g.id))}
              >
                {g.title}
              </Chip>
            ))}
          </FilterChipGroup>
        ) : null}

        {tags.length > 0 ? (
          <FilterChipGroup label="Tags">
            {tags.slice(0, 15).map((tag) => (
              <Chip key={tag} active={filter.tags.includes(tag)} onClick={() => set('tags', toggleIn(filter.tags, tag))}>
                #{tag}
              </Chip>
            ))}
          </FilterChipGroup>
        ) : null}

        <Chip active={filter.includeClosed} onClick={() => set('includeClosed', !filter.includeClosed)}>
          Show done
        </Chip>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="t-meta t-num">{resultCount} task{resultCount === 1 ? '' : 's'}</span>
        {isFilterActive(filter) ? (
          <Button
            variant="link"
            size="xs"
            onClick={() =>
              onChange({
                search: '', trackerIds: [], statuses: [], goalIds: [], milestoneId: null,
                priorities: [], dateScope: 'all', tags: [], includeClosed: false,
              })
            }
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FilterChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2 py-1">
      <span className="t-label shrink-0">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'max-w-[9rem] truncate rounded-full border px-2 py-0.5 text-2xs font-medium transition-colors',
        active
          ? 'border-accent/30 bg-accent-soft text-accent-ink'
          : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
