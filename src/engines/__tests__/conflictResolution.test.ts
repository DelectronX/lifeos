import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULING_CONFIG as BASE } from '@/config/schedulingConfig';
import { detectConflicts, resolveConflicts } from '@/engines/conflictResolution';
import type { SchedulingConfig } from '@/types';
import { DAY, PREFS, at, makeBlock, resetIds } from './fixtures';

const CONFIG: SchedulingConfig = {
  ...BASE,
  slots: { ...BASE.slots, leadTimeMinutes: 0 },
};

/**
 * Day under test (working hours 9-18):
 *   09:00-10:00  Maths      (overruns)
 *   10:00-11:00  Physics    (flexible)
 *   13:00-14:00  Lunch      (protected)
 *   14:00-15:00  Chemistry  (flexible)
 */
function buildDay() {
  const maths = makeBlock({ id: 'maths', title: 'Maths', start: at(DAY, 9), end: at(DAY, 10) });
  const physics = makeBlock({ id: 'physics', title: 'Physics', start: at(DAY, 10), end: at(DAY, 11) });
  const lunch = makeBlock({
    id: 'lunch', title: 'Lunch', kind: 'meal', protected: true,
    start: at(DAY, 13), end: at(DAY, 14),
  });
  const chem = makeBlock({ id: 'chem', title: 'Chemistry', start: at(DAY, 14), end: at(DAY, 15) });
  return { maths, physics, lunch, chem, all: [maths, physics, lunch, chem] };
}

describe('detectConflicts', () => {
  it('finds no conflict when a block finishes on time', () => {
    resetIds();
    const d = buildDay();
    const r = detectConflicts(
      { block: d.maths, actualEnd: d.maths.end, dayBlocks: d.all, now: new Date(at(DAY, 10)) },
      CONFIG,
    );
    expect(r.overrunMinutes).toBe(0);
    expect(r.conflicts).toHaveLength(0);
    expect(r.summary).toContain('nothing downstream is affected');
  });

  it('treats a small overrun as within tolerance', () => {
    resetIds();
    const d = buildDay();
    const r = detectConflicts(
      { block: d.maths, actualEnd: at(DAY, 10, 3), dayBlocks: d.all, now: new Date(at(DAY, 10)) },
      CONFIG,
    );
    expect(r.overrunMinutes).toBe(3);
    expect(r.withinTolerance).toBe(true);
  });

  it('detects the downstream collision and quantifies the overlap', () => {
    resetIds();
    const d = buildDay();
    const r = detectConflicts(
      { block: d.maths, actualEnd: at(DAY, 10, 30), dayBlocks: d.all, now: new Date(at(DAY, 10, 30)) },
      CONFIG,
    );
    expect(r.overrunMinutes).toBe(30);
    expect(r.withinTolerance).toBe(false);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.blockId).toBe('physics');
    expect(r.conflicts[0]!.overlapMinutes).toBe(30);
    expect(r.summary).toContain('Physics');
  });

  it('identifies a protected block as the immovable wall', () => {
    resetIds();
    const d = buildDay();
    // Maths runs until 13:30, colliding with Physics AND protected Lunch.
    const r = detectConflicts(
      { block: d.maths, actualEnd: at(DAY, 13, 30), dayBlocks: d.all, now: new Date(at(DAY, 13, 30)) },
      CONFIG,
    );
    expect(r.conflicts.map((c) => c.blockId)).toEqual(['physics', 'lunch']);
    expect(r.firstImmovable!.blockId).toBe('lunch');
    expect(r.firstImmovable!.immovable).toBe(true);
    expect(r.summary).toContain('protected');
  });

  it('reports no conflict when the overrun spills into free time', () => {
    resetIds();
    const d = buildDay();
    const r = detectConflicts(
      { block: d.chem, actualEnd: at(DAY, 15, 45), dayBlocks: d.all, now: new Date(at(DAY, 15, 45)) },
      CONFIG,
    );
    expect(r.overrunMinutes).toBe(45);
    expect(r.conflicts).toHaveLength(0);
    expect(r.summary).toContain('nothing else is displaced');
  });
});

describe('resolveConflicts', () => {
  const input = (actualEnd: number) => {
    const d = buildDay();
    return {
      block: d.maths, actualEnd, dayBlocks: d.all,
      now: new Date(actualEnd), preferences: PREFS,
    };
  };

  it('returns no strategies when there is nothing to resolve', () => {
    resetIds();
    const r = resolveConflicts(input(at(DAY, 10)), CONFIG);
    expect(r.strategies).toHaveLength(0);
    expect(r.recommended).toBeNull();
  });

  it('offers several distinct strategies, each with a why and a preview', () => {
    resetIds();
    const r = resolveConflicts(input(at(DAY, 10, 30)), CONFIG);
    const kinds = r.strategies.map((s) => s.kind);

    expect(kinds).toContain('shift_all');
    expect(kinds).toContain('preserve_fixed');
    expect(kinds).toContain('next_free_slot');
    expect(kinds).toContain('truncate');

    for (const s of r.strategies) {
      expect(s.why.length).toBeGreaterThan(30);
      expect(s.preview.currentPlan.length).toBeGreaterThan(0);
      expect(s.preview.proposedPlan.length).toBeGreaterThan(0);
      expect(s.preview.date).toBe(DAY);
    }
  });

  it('the current plan shows the real overrun end, not the planned one', () => {
    resetIds();
    const r = resolveConflicts(input(at(DAY, 10, 30)), CONFIG);
    const maths = r.strategies[0]!.preview.currentPlan.find((p) => p.blockId === 'maths')!;
    expect(maths.end).toBe(at(DAY, 10, 30));
    expect(maths.changed).toBe(true);
  });

  it('shift_all pushes every flexible block by the overrun and leaves fixed alone', () => {
    resetIds();
    const r = resolveConflicts(input(at(DAY, 10, 30)), CONFIG);
    const shift = r.strategies.find((s) => s.kind === 'shift_all')!;

    const physics = shift.changes.find((c) => c.blockId === 'physics')!;
    expect(physics.action).toBe('shift');
    expect(physics.deltaMinutes).toBe(30);
    expect(physics.to!.start).toBe(at(DAY, 10, 30));

    const lunch = shift.changes.find((c) => c.blockId === 'lunch')!;
    expect(lunch.action).toBe('unchanged');
    expect(lunch.reason).toContain('Protected');
  });

  it('marks shift_all infeasible when shifting would run into a protected block', () => {
    resetIds();
    // Physics 10-11 shifted by 150 min lands 12:30-13:30, hitting protected Lunch.
    const r = resolveConflicts(input(at(DAY, 12, 30)), CONFIG);
    const shift = r.strategies.find((s) => s.kind === 'shift_all')!;
    expect(shift.feasible).toBe(false);
    expect(shift.respectsFixed).toBe(false);
    expect(shift.infeasibleReason).toContain('Lunch');
    expect(r.recommended!.kind).not.toBe('shift_all');
  });

  it('preserve_fixed keeps the locked/protected block exactly where it is', () => {
    resetIds();
    const r = resolveConflicts(input(at(DAY, 12, 30)), CONFIG);
    const keep = r.strategies.find((s) => s.kind === 'preserve_fixed')!;

    expect(keep.respectsFixed).toBe(true);
    expect(keep.feasible).toBe(true);

    const lunchRow = keep.preview.proposedPlan.find((p) => p.blockId === 'lunch')!;
    expect(lunchRow.start).toBe(at(DAY, 13));
    expect(lunchRow.end).toBe(at(DAY, 14));
    expect(lunchRow.changed).toBe(false);

    // Physics is repacked into a real gap, never over Lunch.
    const physRow = keep.preview.proposedPlan.find((p) => p.blockId === 'physics');
    if (physRow) {
      expect(physRow.start >= at(DAY, 14) || physRow.end <= at(DAY, 13)).toBe(true);
    }
  });

  it('marks preserve_fixed infeasible when the overrun already invades protected time', () => {
    resetIds();
    // Maths runs to 13:30 — it has already eaten 30 min of protected Lunch.
    const r = resolveConflicts(input(at(DAY, 13, 30)), CONFIG);
    const keep = r.strategies.find((s) => s.kind === 'preserve_fixed')!;
    expect(keep.feasible).toBe(false);
    expect(keep.respectsFixed).toBe(false);
    expect(keep.infeasibleReason).toContain('Lunch');
    expect(keep.why).toContain('already run');
  });

  it('never proposes a plan where two blocks it controls overlap', () => {
    resetIds();
    for (const end of [at(DAY, 10, 30), at(DAY, 12, 30), at(DAY, 13, 30)]) {
      const r = resolveConflicts(input(end), CONFIG);
      for (const s of r.strategies.filter((x) => x.feasible)) {
        // The overrunning block's own spill is already reality; the engine is
        // only accountable for the blocks it repositions.
        const rows = s.preview.proposedPlan.filter((p) => p.blockId !== 'maths');
        for (let i = 0; i < rows.length; i++) {
          for (let j = i + 1; j < rows.length; j++) {
            const overlap = rows[i]!.start < rows[j]!.end && rows[j]!.start < rows[i]!.end;
            expect(overlap, `${s.kind}: ${rows[i]!.title} vs ${rows[j]!.title}`).toBe(false);
          }
        }
      }
    }
  });

  it('no feasible strategy ever moves a block onto locked or protected time', () => {
    resetIds();
    for (const end of [at(DAY, 10, 30), at(DAY, 12, 30)]) {
      const r = resolveConflicts(input(end), CONFIG);
      for (const s of r.strategies.filter((x) => x.feasible)) {
        const fixedRows = s.preview.proposedPlan.filter((p) => p.locked || p.protected);
        const moved = s.changes.filter((c) => c.action !== 'unchanged' && c.to !== null);
        for (const m of moved) {
          for (const f of fixedRows) {
            if (f.blockId === m.blockId) continue;
            const clash = m.to!.start < f.end && f.start < m.to!.end;
            expect(clash, `${s.kind}: ${m.title} onto ${f.title}`).toBe(false);
          }
        }
      }
    }
  });

  it('truncate absorbs the overrun without moving anything downstream', () => {
    resetIds();
    const r = resolveConflicts(input(at(DAY, 10, 20)), CONFIG);
    const trunc = r.strategies.find((s) => s.kind === 'truncate')!;

    expect(trunc.feasible).toBe(true);
    const physics = trunc.changes.find((c) => c.blockId === 'physics')!;
    expect(physics.action).toBe('shrink');
    expect(physics.to!.start).toBe(at(DAY, 10, 20));
    expect(physics.to!.end).toBe(at(DAY, 11));
    expect(physics.deltaMinutes).toBe(-20);

    // Everything else keeps its original time.
    for (const c of trunc.changes.filter((x) => x.blockId !== 'physics')) {
      expect(c.action).toBe('unchanged');
    }
    expect(trunc.why).toContain('nothing after it moves');
  });

  it('refuses to truncate below the configured shrink floor', () => {
    resetIds();
    // Physics would be cut to 10 of 60 min — well below the 50% floor.
    const r = resolveConflicts(input(at(DAY, 10, 50)), CONFIG);
    const trunc = r.strategies.find((s) => s.kind === 'truncate')!;
    expect(trunc.feasible).toBe(false);
    expect(trunc.infeasibleReason).toContain('floor');
  });

  it('next_free_slot relocates only the displaced block', () => {
    resetIds();
    const r = resolveConflicts(input(at(DAY, 10, 30)), CONFIG);
    const move = r.strategies.find((s) => s.kind === 'next_free_slot')!;

    expect(move.feasible).toBe(true);
    const physics = move.changes.find((c) => c.blockId === 'physics')!;
    expect(physics.action).toBe('move');
    expect(physics.to!.start).toBeGreaterThanOrEqual(at(DAY, 10, 30));
    // Full duration preserved.
    expect(physics.to!.end - physics.to!.start).toBe(60 * 60_000);

    for (const c of move.changes.filter((x) => x.blockId !== 'physics')) {
      expect(c.action).toBe('unchanged');
    }
  });

  it('recommends a strategy that respects fixed blocks', () => {
    resetIds();
    const r = resolveConflicts(input(at(DAY, 12, 30)), CONFIG);
    expect(r.recommended).not.toBeNull();
    expect(r.recommended!.respectsFixed).toBe(true);
    expect(r.recommended!.feasible).toBe(true);
  });

  it('applies nothing: the input blocks are never mutated', () => {
    resetIds();
    const d = buildDay();
    const snapshot = JSON.stringify(d.all);
    resolveConflicts(
      {
        block: d.maths, actualEnd: at(DAY, 12, 30), dayBlocks: d.all,
        now: new Date(at(DAY, 12, 30)), preferences: PREFS,
      },
      CONFIG,
    );
    expect(JSON.stringify(d.all)).toBe(snapshot);
  });
});
