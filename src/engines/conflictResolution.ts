import type {
  DateKey, ID, SchedulingConfig, ScheduleBlock, Timestamp,
} from '@/types';
import type {
  PlanEntry, ProposedBlockChange, SchedulePreview, SchedulingPreferences,
} from '@/types/scheduling';
import { MINUTE_MS, atMinute, minuteOfDay, toDateKey } from '@/lib/date';
import { computeAvailability } from './scheduling';

/**
 * ConflictResolutionEngine — what happens to the rest of the day when a block
 * runs long.
 *
 * Given a block that overran (or was resized/moved), it finds every downstream
 * block that now collides and generates candidate strategies:
 *
 *   shift_all      push every following flexible block forward by the overrun
 *   preserve_fixed keep locked/protected blocks where they are, move only the
 *                  flexible ones around them
 *   split          keep what fits before the next fixed block, move the rest
 *   next_free_slot leave the day alone, relocate the displaced work later
 *   truncate       accept the overrun and shorten the following block
 *
 * Each strategy returns a full before/after preview and a plain-English "why".
 * The engine applies nothing — it returns proposals only.
 */

export type ConflictStrategyKind =
  | 'shift_all' | 'preserve_fixed' | 'split' | 'next_free_slot' | 'truncate';

export interface BlockConflict {
  blockId: ID;
  title: string;
  /** Minutes of genuine overlap with the overrunning block. */
  overlapMinutes: number;
  locked: boolean;
  protected: boolean;
  /** True when the engine is not permitted to move it. */
  immovable: boolean;
}

export interface ConflictDetectionInput {
  /** The block that ran long. */
  block: ScheduleBlock;
  /** Its real new end time. */
  actualEnd: Timestamp;
  /** All blocks for the affected day (the overrunning block may be included). */
  dayBlocks: readonly ScheduleBlock[];
  now: Date;
}

export interface ConflictDetection {
  blockId: ID;
  date: DateKey;
  overrunMinutes: number;
  /** True when the overrun is inside the configured tolerance. */
  withinTolerance: boolean;
  conflicts: BlockConflict[];
  /** The first immovable block downstream — the wall the day must respect. */
  firstImmovable: BlockConflict | null;
  summary: string;
}

export function detectConflicts(
  input: ConflictDetectionInput,
  config: SchedulingConfig,
): ConflictDetection {
  const { block, actualEnd } = input;
  const overrunMinutes = Math.round((actualEnd - block.end) / MINUTE_MS);

  const downstream = input.dayBlocks
    .filter((b) => b.id !== block.id)
    .filter((b) => b.status === 'planned' || b.status === 'in_progress')
    .filter((b) => b.end > block.end)
    .sort((a, b) => a.start - b.start);

  const conflicts: BlockConflict[] = downstream
    .filter((b) => b.start < actualEnd)
    .map((b) => ({
      blockId: b.id,
      title: b.title,
      overlapMinutes: Math.round((Math.min(actualEnd, b.end) - Math.max(block.end, b.start)) / MINUTE_MS),
      locked: b.locked,
      protected: b.protected,
      immovable: b.locked || b.protected,
    }));

  const firstImmovable = conflicts.find((c) => c.immovable) ?? null;
  const withinTolerance = overrunMinutes <= config.rescheduling.overrunToleranceMinutes;

  return {
    blockId: block.id,
    date: block.date,
    overrunMinutes,
    withinTolerance,
    conflicts,
    firstImmovable,
    summary: buildDetectionSummary(block, overrunMinutes, withinTolerance, conflicts, firstImmovable),
  };
}

function buildDetectionSummary(
  block: ScheduleBlock, overrun: number, withinTolerance: boolean,
  conflicts: BlockConflict[], firstImmovable: BlockConflict | null,
): string {
  if (overrun <= 0) return `"${block.title}" finished on or before its planned end — nothing downstream is affected.`;
  if (withinTolerance) return `"${block.title}" ran ${overrun} min over, which is inside the tolerance — no changes needed.`;
  if (conflicts.length === 0) return `"${block.title}" ran ${overrun} min over into free time — nothing else is displaced.`;
  const names = conflicts.map((c) => `"${c.title}"`).join(', ');
  const wall = firstImmovable
    ? ` "${firstImmovable.title}" is ${firstImmovable.protected ? 'protected' : 'locked'} and cannot move, so everything must fit before it.`
    : '';
  return `"${block.title}" ran ${overrun} min over and now collides with ${conflicts.length} block${conflicts.length === 1 ? '' : 's'}: ${names}.${wall}`;
}

/* ------------------------------------------------------------------ */
/* Strategies                                                          */
/* ------------------------------------------------------------------ */

export interface ConflictStrategy {
  kind: ConflictStrategyKind;
  label: string;
  /** Plain-English rationale shown above the preview. */
  why: string;
  changes: ProposedBlockChange[];
  preview: SchedulePreview;
  /** Blocks pushed out of the day entirely; they need rescheduling. */
  displacedBlockIds: ID[];
  /** Total minutes of movement — a rough "how disruptive is this" measure. */
  disruptionMinutes: number;
  /** True when no locked or protected block is touched. */
  respectsFixed: boolean;
  /** Higher is better. Deterministic ranking hint. */
  score: number;
  feasible: boolean;
  infeasibleReason?: string;
}

export interface ResolveConflictInput extends ConflictDetectionInput {
  preferences: SchedulingPreferences;
}

export interface ConflictResolutionResult {
  detection: ConflictDetection;
  strategies: ConflictStrategy[];
  recommended: ConflictStrategy | null;
}

export function resolveConflicts(
  input: ResolveConflictInput,
  config: SchedulingConfig,
): ConflictResolutionResult {
  const detection = detectConflicts(input, config);
  const { block, actualEnd } = input;

  if (detection.overrunMinutes <= 0 || detection.withinTolerance || detection.conflicts.length === 0) {
    return { detection, strategies: [], recommended: null };
  }

  const overrunMs = actualEnd - block.end;
  const dayEnd = dayBoundaryEnd(input, config);

  // Blocks that could be affected, in start order.
  const downstream = input.dayBlocks
    .filter((b) => b.id !== block.id && b.start >= block.start && b.end > block.end)
    .filter((b) => b.status === 'planned' || b.status === 'in_progress')
    .sort((a, b) => a.start - b.start);

  const current = buildPlan(input.dayBlocks, actualEnd, block.id, new Map());

  const strategies: ConflictStrategy[] = [
    buildShiftAll(input, detection, downstream, overrunMs, dayEnd, current),
    buildPreserveFixed(input, detection, downstream, actualEnd, dayEnd, current),
    buildSplit(input, detection, downstream, actualEnd, current),
    buildNextFreeSlot(input, detection, downstream, actualEnd, current, config),
    buildTruncate(input, detection, downstream, actualEnd, current, config),
  ].filter((s): s is ConflictStrategy => s !== null);

  const feasible = strategies.filter((s) => s.feasible);
  const recommended = feasible.length > 0
    ? [...feasible].sort((a, b) => {
        if (a.respectsFixed !== b.respectsFixed) return a.respectsFixed ? -1 : 1;
        if (a.displacedBlockIds.length !== b.displacedBlockIds.length) {
          return a.displacedBlockIds.length - b.displacedBlockIds.length;
        }
        if (b.score !== a.score) return b.score - a.score;
        return a.disruptionMinutes - b.disruptionMinutes;
      })[0]!
    : null;

  return { detection, strategies, recommended };
}

/* --- strategy 1: shift everything flexible forward -------------------- */

function buildShiftAll(
  input: ResolveConflictInput,
  detection: ConflictDetection,
  downstream: readonly ScheduleBlock[],
  overrunMs: number,
  dayEnd: Timestamp,
  current: PlanEntry[],
): ConflictStrategy {
  const changes: ProposedBlockChange[] = [];
  const moves = new Map<ID, { start: Timestamp; end: Timestamp } | null>();
  const displaced: ID[] = [];
  let hitFixed: ScheduleBlock | null = null;

  for (const b of downstream) {
    if (b.locked || b.protected) {
      hitFixed = hitFixed ?? b;
      changes.push(unchangedChange(b, `${b.protected ? 'Protected' : 'Locked'} — left exactly where it is.`));
      continue;
    }
    const start = b.start + overrunMs;
    const end = b.end + overrunMs;
    if (end > dayEnd) {
      displaced.push(b.id);
      moves.set(b.id, null);
      changes.push({
        blockId: b.id, title: b.title, action: 'drop',
        from: { start: b.start, end: b.end }, to: null,
        deltaMinutes: 0,
        reason: 'Pushed past the end of your working day — needs a new slot on another day.',
      });
      continue;
    }
    moves.set(b.id, { start, end });
    changes.push({
      blockId: b.id, title: b.title, action: 'shift',
      from: { start: b.start, end: b.end }, to: { start, end },
      deltaMinutes: Math.round(overrunMs / MINUTE_MS),
      reason: `Pushed back ${Math.round(overrunMs / MINUTE_MS)} min to absorb the overrun.`,
    });
  }

  // Shifting into a fixed block is not a resolution — it is a new collision.
  const collidesWithFixed = downstream.some((f) => {
    if (!f.locked && !f.protected) return false;
    for (const [, m] of moves) {
      if (m && m.start < f.end && f.start < m.end) return true;
    }
    return false;
  });

  const why = collidesWithFixed
    ? `Pushing everything back ${detection.overrunMinutes} min would run into "${hitFixed?.title ?? 'a fixed block'}", which cannot move.`
    : `Everything after "${input.block.title}" slides ${detection.overrunMinutes} min later. Simplest option: the order of your day is preserved${displaced.length > 0 ? `, but ${displaced.length} block${displaced.length === 1 ? '' : 's'} fall off the end of the day` : ' and nothing is lost'}.`;

  return {
    kind: 'shift_all',
    label: 'Shift everything forward',
    why,
    changes,
    preview: makePreview(input, current, changes, why),
    displacedBlockIds: displaced,
    disruptionMinutes: changes.filter((c) => c.action === 'shift').length * detection.overrunMinutes,
    respectsFixed: !collidesWithFixed,
    score: collidesWithFixed ? 0 : 70 - displaced.length * 20,
    feasible: !collidesWithFixed,
    ...(collidesWithFixed
      ? { infeasibleReason: `"${hitFixed?.title ?? 'A fixed block'}" is ${hitFixed?.protected ? 'protected' : 'locked'} and would be overrun.` }
      : {}),
  };
}

/* --- strategy 2: preserve fixed, repack flexible ---------------------- */

function buildPreserveFixed(
  input: ResolveConflictInput,
  detection: ConflictDetection,
  downstream: readonly ScheduleBlock[],
  actualEnd: Timestamp,
  dayEnd: Timestamp,
  current: PlanEntry[],
): ConflictStrategy {
  const fixed = downstream.filter((b) => b.locked || b.protected);
  const flexible = downstream.filter((b) => !b.locked && !b.protected);

  const changes: ProposedBlockChange[] = fixed.map((b) =>
    unchangedChange(b, `${b.protected ? 'Protected' : 'Locked'} time — kept exactly as planned.`));

  // Greedily repack flexible blocks into the gaps left between fixed blocks.
  const busy = fixed.map((b) => ({ start: b.start, end: b.end }));
  let cursor = actualEnd;
  const displaced: ID[] = [];
  let totalShift = 0;

  for (const b of flexible) {
    const duration = b.end - b.start;
    let start = Math.max(cursor, b.start);
    let placed = false;

    for (let guard = 0; guard < 64; guard++) {
      const clash = busy.find((f) => start < f.end && f.start < start + duration);
      if (!clash) { placed = start + duration <= dayEnd; break; }
      start = clash.end;
    }

    if (!placed || start + duration > dayEnd) {
      displaced.push(b.id);
      changes.push({
        blockId: b.id, title: b.title, action: 'drop',
        from: { start: b.start, end: b.end }, to: null,
        deltaMinutes: 0,
        reason: 'No gap left between your fixed commitments today — needs another day.',
      });
      continue;
    }

    const end = start + duration;
    const delta = Math.round((start - b.start) / MINUTE_MS);
    totalShift += Math.abs(delta);
    busy.push({ start, end });
    cursor = end;
    changes.push({
      blockId: b.id, title: b.title,
      action: delta === 0 ? 'unchanged' : 'move',
      from: { start: b.start, end: b.end },
      to: { start, end },
      deltaMinutes: delta,
      reason: delta === 0
        ? 'Still fits at its original time.'
        : `Moved ${delta > 0 ? 'later' : 'earlier'} by ${Math.abs(delta)} min to fit around your fixed blocks.`,
    });
  }

  const fixedNames = fixed.map((f) => `"${f.title}"`).join(' and ');

  // The overrun may ALREADY have eaten into fixed time — reality broke the
  // constraint before the engine got here. We must not claim to preserve it.
  const invaded = fixed.find((f) => actualEnd > f.start && input.block.start < f.end) ?? null;

  const why = invaded
    ? `"${input.block.title}" has already run ${detection.overrunMinutes} min over and into ${invaded.protected ? 'protected' : 'locked'} time ("${invaded.title}"), so that block cannot be preserved as planned — stop now, or shorten "${invaded.title}" deliberately.`
    : fixed.length > 0
      ? `${fixedNames} stay${fixed.length === 1 ? 's' : ''} put; only your flexible work moves around ${fixed.length === 1 ? 'it' : 'them'} to absorb the ${detection.overrunMinutes} min overrun.${displaced.length > 0 ? ` ${displaced.length} block${displaced.length === 1 ? '' : 's'} could not fit and need${displaced.length === 1 ? 's' : ''} a new day.` : ''}`
      : `Nothing downstream is fixed, so flexible work is simply repacked from ${fmt(actualEnd)} onward, absorbing the ${detection.overrunMinutes} min overrun.`;

  return {
    kind: 'preserve_fixed',
    label: 'Keep fixed blocks, move the flexible ones',
    why,
    changes,
    preview: makePreview(input, current, changes, why),
    displacedBlockIds: displaced,
    disruptionMinutes: totalShift,
    respectsFixed: !invaded,
    score: 85 - displaced.length * 15,
    feasible: !invaded,
    ...(invaded
      ? { infeasibleReason: `The overrun already overlaps ${invaded.protected ? 'protected' : 'locked'} block "${invaded.title}".` }
      : {}),
  };
}

/* --- strategy 3: split the next block --------------------------------- */

function buildSplit(
  input: ResolveConflictInput,
  detection: ConflictDetection,
  downstream: readonly ScheduleBlock[],
  actualEnd: Timestamp,
  current: PlanEntry[],
): ConflictStrategy | null {
  const victim = downstream.find((b) => !b.locked && !b.protected && b.start < actualEnd);
  if (!victim) return null;

  const wall = downstream.find((b) => (b.locked || b.protected) && b.start >= actualEnd);
  const availableEnd = wall ? wall.start : victim.end;
  const fitMinutes = Math.max(0, Math.round((availableEnd - actualEnd) / MINUTE_MS));
  const totalMinutes = Math.round((victim.end - victim.start) / MINUTE_MS);
  const leftover = totalMinutes - fitMinutes;

  const feasible = fitMinutes >= input.preferences.focusHours.length * 0 + 10 && leftover > 0;

  const changes: ProposedBlockChange[] = [{
    blockId: victim.id,
    title: victim.title,
    action: 'split',
    from: { start: victim.start, end: victim.end },
    to: { start: actualEnd, end: actualEnd + fitMinutes * MINUTE_MS },
    deltaMinutes: -leftover,
    reason: `Keeps ${fitMinutes} of ${totalMinutes} min today${wall ? ` before "${wall.title}"` : ''}; the remaining ${leftover} min becomes a second session.`,
  }];
  for (const b of downstream) {
    if (b.id === victim.id) continue;
    changes.push(unchangedChange(b, 'Unaffected by the split.'));
  }

  const why = feasible
    ? `"${victim.title}" is split: ${fitMinutes} min now (all that fits${wall ? ` before "${wall.title}"` : ''} after the ${detection.overrunMinutes} min overrun), ${leftover} min rescheduled. You still make progress today instead of losing the session.`
    : `"${victim.title}" cannot usefully be split — the ${detection.overrunMinutes} min overrun leaves only ${fitMinutes} min today.`;

  return {
    kind: 'split',
    label: `Split "${victim.title}"`,
    why,
    changes,
    preview: makePreview(input, current, changes, why),
    displacedBlockIds: [],
    disruptionMinutes: leftover,
    respectsFixed: true,
    score: 60,
    feasible,
    ...(feasible ? {} : { infeasibleReason: `Only ${fitMinutes} min would be left — too short to be worth a session.` }),
  };
}

/* --- strategy 4: relocate to the next free slot ----------------------- */

function buildNextFreeSlot(
  input: ResolveConflictInput,
  detection: ConflictDetection,
  downstream: readonly ScheduleBlock[],
  actualEnd: Timestamp,
  current: PlanEntry[],
  config: SchedulingConfig,
): ConflictStrategy | null {
  const victim = downstream.find((b) => !b.locked && !b.protected && b.start < actualEnd);
  if (!victim) return null;

  const duration = victim.end - victim.start;
  const availability = computeAvailability(
    {
      from: detection.date,
      to: detection.date,
      workingHours: input.preferences.workingHours,
      blocks: input.dayBlocks,
      now: new Date(actualEnd),
      ignoreBlockIds: [victim.id, input.block.id],
    },
    config,
  );

  const slot = availability[0]?.slots.find((s) => s.start >= actualEnd && (s.end - s.start) >= duration);

  const changes: ProposedBlockChange[] = [];
  if (slot) {
    changes.push({
      blockId: victim.id, title: victim.title, action: 'move',
      from: { start: victim.start, end: victim.end },
      to: { start: slot.start, end: slot.start + duration },
      deltaMinutes: Math.round((slot.start - victim.start) / MINUTE_MS),
      reason: `Relocated whole into the next ${Math.round((slot.end - slot.start) / MINUTE_MS)} min gap at ${fmt(slot.start)}.`,
    });
  }
  for (const b of downstream) {
    if (b.id === victim.id) continue;
    changes.push(unchangedChange(b, 'Left exactly where it is.'));
  }

  const why = slot
    ? `Only "${victim.title}" moves — it drops whole into the free gap at ${fmt(slot.start)} later today. Everything else in your day is untouched.`
    : `There is no free gap left today big enough for "${victim.title}" (${Math.round(duration / MINUTE_MS)} min).`;

  return {
    kind: 'next_free_slot',
    label: `Move "${victim.title}" to the next free gap`,
    why,
    changes,
    preview: makePreview(input, current, changes, why),
    displacedBlockIds: slot ? [] : [victim.id],
    disruptionMinutes: slot ? Math.round((slot.start - victim.start) / MINUTE_MS) : 0,
    respectsFixed: true,
    score: slot ? 90 : 0,
    feasible: Boolean(slot),
    ...(slot ? {} : { infeasibleReason: 'No remaining gap today is long enough.' }),
  };
}

/* --- strategy 5: truncate the next block ------------------------------ */

function buildTruncate(
  input: ResolveConflictInput,
  detection: ConflictDetection,
  downstream: readonly ScheduleBlock[],
  actualEnd: Timestamp,
  current: PlanEntry[],
  config: SchedulingConfig,
): ConflictStrategy | null {
  const victim = downstream.find((b) => !b.locked && !b.protected && b.start < actualEnd);
  if (!victim) return null;

  const originalMinutes = Math.round((victim.end - victim.start) / MINUTE_MS);
  const newMinutes = Math.max(0, Math.round((victim.end - actualEnd) / MINUTE_MS));
  const floor = Math.round(originalMinutes * config.rescheduling.minShrinkFactor);
  const feasible = newMinutes >= floor && newMinutes > 0;

  const changes: ProposedBlockChange[] = [{
    blockId: victim.id, title: victim.title, action: 'shrink',
    from: { start: victim.start, end: victim.end },
    to: { start: actualEnd, end: victim.end },
    deltaMinutes: newMinutes - originalMinutes,
    reason: `Starts late and finishes on time: ${newMinutes} min instead of ${originalMinutes}.`,
  }];
  for (const b of downstream) {
    if (b.id === victim.id) continue;
    changes.push(unchangedChange(b, 'Unaffected — the rest of the day keeps its original times.'));
  }

  const why = feasible
    ? `Absorb the overrun inside "${victim.title}": it starts ${detection.overrunMinutes} min late and still ends on time, so nothing after it moves at all. You lose ${originalMinutes - newMinutes} min of that session.`
    : `Shortening "${victim.title}" to ${newMinutes} min cuts below the ${Math.round(config.rescheduling.minShrinkFactor * 100)}% floor (${floor} min) — not worth doing.`;

  return {
    kind: 'truncate',
    label: `Shorten "${victim.title}"`,
    why,
    changes,
    preview: makePreview(input, current, changes, why),
    displacedBlockIds: [],
    disruptionMinutes: originalMinutes - newMinutes,
    respectsFixed: true,
    score: 50,
    feasible,
    ...(feasible ? {} : { infeasibleReason: `Would cut the session to ${newMinutes} min, below the ${floor} min floor.` }),
  };
}

/* ------------------------------------------------------------------ */
/* Preview construction                                                */
/* ------------------------------------------------------------------ */

function makePreview(
  input: ResolveConflictInput,
  current: PlanEntry[],
  changes: readonly ProposedBlockChange[],
  why: string,
): SchedulePreview {
  const moves = new Map<ID, { start: Timestamp; end: Timestamp } | null>();
  for (const c of changes) {
    if (c.action === 'unchanged') continue;
    moves.set(c.blockId, c.to);
  }
  return {
    date: input.block.date,
    currentPlan: current,
    proposedPlan: buildPlan(input.dayBlocks, input.actualEnd, input.block.id, moves),
    why,
  };
}

/**
 * Renders the day as an ordered list of rows. The overrunning block always
 * shows its REAL end so the preview reflects reality, not the plan.
 */
function buildPlan(
  blocks: readonly ScheduleBlock[],
  actualEnd: Timestamp,
  overrunBlockId: ID,
  moves: ReadonlyMap<ID, { start: Timestamp; end: Timestamp } | null>,
): PlanEntry[] {
  const rows: PlanEntry[] = [];
  for (const b of blocks) {
    if (b.status === 'cancelled') continue;

    if (moves.has(b.id)) {
      const to = moves.get(b.id)!;
      if (to === null) continue; // dropped from the day
      rows.push(entry(b, to.start, to.end, true));
      continue;
    }
    if (b.id === overrunBlockId) {
      rows.push(entry(b, b.start, actualEnd, actualEnd !== b.end));
      continue;
    }
    rows.push(entry(b, b.start, b.end, false));
  }
  return rows.sort((a, b) => a.start - b.start || a.end - b.end);
}

function entry(b: ScheduleBlock, start: Timestamp, end: Timestamp, changed: boolean): PlanEntry {
  return {
    blockId: b.id,
    title: b.title,
    start,
    end,
    startMinute: minuteOfDay(start),
    endMinute: minuteOfDay(end - 1) + 1,
    locked: b.locked,
    protected: b.protected,
    changed,
  };
}

function unchangedChange(b: ScheduleBlock, reason: string): ProposedBlockChange {
  return {
    blockId: b.id, title: b.title, action: 'unchanged',
    from: { start: b.start, end: b.end },
    to: { start: b.start, end: b.end },
    deltaMinutes: 0,
    reason,
  };
}

/** End of the working day, or midnight when no working hours are defined. */
function dayBoundaryEnd(input: ResolveConflictInput, _config: SchedulingConfig): Timestamp {
  const date = input.block.date;
  const dow = new Date(atMinute(date, 0)).getDay();
  const ranges = input.preferences.workingHours[dow] ?? [];
  if (ranges.length === 0) return atMinute(date, 24 * 60);
  const lastEnd = ranges.reduce((m, r) => Math.max(m, r.endMinute), 0);
  return atMinute(date, lastEnd);
}

function fmt(ts: Timestamp): string {
  const m = minuteOfDay(ts);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm < 10 ? '0' : ''}${mm} ${suffix}`;
}

export type { PlanEntry, SchedulePreview, ProposedBlockChange };

/** Convenience: the calendar day a timestamp belongs to. */
export function conflictDateOf(ts: Timestamp): DateKey {
  return toDateKey(ts);
}
