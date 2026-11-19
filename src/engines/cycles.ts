import { addDaysToKey, diffDays } from '@/lib/date';
import type { CycleDefinition, CyclePhase, DateKey } from '@/types';

/**
 * CycleEngine — pure date maths for multi-phase repeating cycles.
 *
 * A cycle is `phases[]` laid end to end from `anchorDate`, repeating forever.
 * With phases [Prep 7d, Exam 7d] every 14 days is one cycle; with
 * [Test Sunday 7d, Normal Sunday 7d] a weekly rule bound to phase "test"
 * fires on alternating Sundays. Nothing here knows what the phases MEAN —
 * that is the user's data.
 */

export interface PhaseOnDate {
  cycle: CycleDefinition;
  phase: CyclePhase;
  phaseIndex: number;
  /** 0-based repetition of the whole cycle containing `date`. */
  cycleIndex: number;
  /** Inclusive first and last day of this phase occurrence. */
  start: DateKey;
  end: DateKey;
}

export function cycleLengthDays(cycle: CycleDefinition): number {
  return cycle.phases.reduce((s, p) => s + Math.max(0, Math.floor(p.lengthDays)), 0);
}

/** The phase a date falls in, or null before the anchor / for a degenerate cycle. */
export function phaseOn(cycle: CycleDefinition, date: DateKey): PhaseOnDate | null {
  const length = cycleLengthDays(cycle);
  if (length <= 0 || cycle.phases.length === 0) return null;
  const offset = diffDays(cycle.anchorDate, date);
  if (offset < 0) return null;

  const cycleIndex = Math.floor(offset / length);
  let dayInCycle = offset - cycleIndex * length;
  for (let i = 0; i < cycle.phases.length; i++) {
    const phase = cycle.phases[i]!;
    const len = Math.max(0, Math.floor(phase.lengthDays));
    if (dayInCycle < len) {
      const start = addDaysToKey(cycle.anchorDate, cycleIndex * length + (offset - dayInCycle - cycleIndex * length));
      return {
        cycle, phase, phaseIndex: i, cycleIndex,
        start,
        end: addDaysToKey(start, len - 1),
      };
    }
    dayInCycle -= len;
  }
  return null;
}

/** True when `date` falls inside the named phase of the cycle. */
export function isInPhase(cycle: CycleDefinition, phaseKey: string, date: DateKey): boolean {
  return phaseOn(cycle, date)?.phase.key === phaseKey;
}

export interface PhaseOccurrence {
  cycleIndex: number;
  phaseIndex: number;
  phase: CyclePhase;
  start: DateKey;
  end: DateKey;
}

/**
 * Every phase occurrence that ENDS on or before `until` (so only fully
 * elapsed phases are listed), in chronological order. Used by metrics that
 * count completed phases/cycles.
 */
export function elapsedPhases(cycle: CycleDefinition, until: DateKey): PhaseOccurrence[] {
  const length = cycleLengthDays(cycle);
  if (length <= 0) return [];
  const out: PhaseOccurrence[] = [];
  let cursor = cycle.anchorDate;
  let cycleIndex = 0;
  let guard = 0;
  while (guard++ < 5000) {
    for (let i = 0; i < cycle.phases.length; i++) {
      const phase = cycle.phases[i]!;
      const len = Math.max(0, Math.floor(phase.lengthDays));
      if (len === 0) continue;
      const end = addDaysToKey(cursor, len - 1);
      if (end > until) return out;
      out.push({ cycleIndex, phaseIndex: i, phase, start: cursor, end });
      cursor = addDaysToKey(cursor, len);
    }
    cycleIndex++;
  }
  return out;
}

/** Plain-language label like "Exam Week · day 3 of 7". */
export function describePhase(hit: PhaseOnDate, date: DateKey): string {
  const day = diffDays(hit.start, date) + 1;
  const total = Math.max(1, Math.floor(hit.phase.lengthDays));
  return total > 1 ? `${hit.phase.title} · day ${day} of ${total}` : hit.phase.title;
}
