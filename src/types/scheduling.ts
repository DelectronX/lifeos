/**
 * Input/output shapes shared by the scheduling intelligence engines.
 *
 * These types deliberately live outside `src/types/index.ts` (the persisted
 * domain model): nothing here is ever written to Dexie. They describe what the
 * engines *propose*, so the UI can preview and the user can confirm.
 */

import type {
  BlockKind,
  BlockOrigin,
  DateKey,
  ID,
  MinuteOfDay,
  ScheduleBlock,
  TimeRange,
  Timestamp,
  WorkingHours,
} from '@/types';

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

/** A contiguous stretch of schedulable time on one calendar day. */
export interface FreeSlot {
  date: DateKey;
  start: Timestamp;
  end: Timestamp;
  durationMinutes: number;
  startMinute: MinuteOfDay;
  endMinute: MinuteOfDay;
}

export interface DayAvailability {
  date: DateKey;
  /** 0 = Sunday .. 6 = Saturday */
  dayOfWeek: number;
  slots: FreeSlot[];
  /** Sum of every free slot on the day. */
  freeMinutes: number;
  /** Working-hours minutes before existing blocks were subtracted. */
  workingMinutes: number;
  /** Minutes consumed by protected blocks (sleep/school/meals). */
  protectedMinutes: number;
  /** Minutes consumed by non-protected existing blocks. */
  committedMinutes: number;
}

export interface AvailabilityInput {
  from: DateKey;
  to: DateKey;
  workingHours: WorkingHours;
  /** Existing blocks across the range; cancelled/skipped ones are ignored. */
  blocks: readonly ScheduleBlock[];
  /** Reference clock. Nothing is offered before `now + leadTimeMinutes`. */
  now: Date;
  /** Block ids that should be treated as free (e.g. the block being moved). */
  ignoreBlockIds?: readonly ID[];
}

/* ------------------------------------------------------------------ */
/* Proposals                                                           */
/* ------------------------------------------------------------------ */

/**
 * A block an engine wants to create. Never persisted directly by an engine —
 * the service layer materialises it after the user accepts.
 */
export interface ProposedBlock {
  /** Deterministic within one engine run, so previews are stable. */
  tempId: string;
  title: string;
  date: DateKey;
  start: Timestamp;
  end: Timestamp;
  durationMinutes: number;
  trackerId: ID;
  kind: BlockKind;
  taskId: ID | null;
  goalId: ID | null;
  locked: boolean;
  protected: boolean;
  origin: BlockOrigin;
  splitGroupId: ID | null;
  splitIndex: number;
  splitCount: number;
  /** Plain-English justification for this specific placement. */
  reason: string;
}

/** A change an engine proposes to an *existing* block. */
export type BlockChangeAction = 'shift' | 'shrink' | 'move' | 'split' | 'drop' | 'unchanged';

export interface ProposedBlockChange {
  blockId: ID;
  title: string;
  action: BlockChangeAction;
  from: { start: Timestamp; end: Timestamp };
  /** null when the block is dropped/unscheduled. */
  to: { start: Timestamp; end: Timestamp } | null;
  deltaMinutes: number;
  reason: string;
}

/** One row of a before/after schedule preview. */
export interface PlanEntry {
  blockId: ID | null;
  title: string;
  start: Timestamp;
  end: Timestamp;
  startMinute: MinuteOfDay;
  endMinute: MinuteOfDay;
  locked: boolean;
  protected: boolean;
  /** True for rows that differ from the current plan. */
  changed: boolean;
}

export interface SchedulePreview {
  date: DateKey;
  currentPlan: PlanEntry[];
  proposedPlan: PlanEntry[];
  why: string;
}

/* ------------------------------------------------------------------ */
/* Shared scheduling context                                           */
/* ------------------------------------------------------------------ */

export interface SchedulingPreferences {
  workingHours: WorkingHours;
  /** Preferred deep-work ranges; a scoring bonus, never a hard constraint. */
  focusHours: readonly TimeRange[];
}

export type UnplacedReasonCode =
  | 'blocked_by_dependency'
  | 'no_slot_before_deadline'
  | 'no_slot_in_horizon'
  | 'not_splittable_no_contiguous_slot'
  | 'daily_capacity_reached'
  | 'deadline_passed'
  | 'zero_duration'
  | 'outside_allowed_window';

/**
 * A HARD time-window constraint for every task belonging to one subject
 * (Tracker). Derived from an active `ScheduleRule` — see
 * `src/services/scheduleRuleService.ts`. Unlike `Task.preferredWindow` (a
 * soft scoring preference), the scheduling engine treats these as
 * unbreakable: a task whose tracker has active rules is NEVER placed on a
 * day that is not in `days`, or outside `[startMinute, endMinute)` on a day
 * that is.
 */
export interface SubjectWindowRule {
  trackerId: ID;
  /** 0 = Sunday .. 6 = Saturday. */
  days: readonly number[];
  startMinute: MinuteOfDay;
  endMinute: MinuteOfDay;
}

export interface UnplacedTask {
  taskId: ID;
  title: string;
  code: UnplacedReasonCode;
  reason: string;
  /** Minutes that still need a home. */
  missingMinutes: number;
}
