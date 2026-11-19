import { db } from '@/db/db';
import { addDaysToKey } from '@/lib/date';
import { loadCycles, ruleFiresOn } from './recurrenceService';
import { createPaper, deletePaper } from './paperService';
import type { DateKey, ID, Paper, ScheduleBlock, Tracker } from '@/types';

/**
 * Exam planner. A recurring rule whose block template lists `paperSubjects`
 * is a paper slot (an exam-week paper, a Sunday test…). For each upcoming
 * occurrence the user picks the subject; that creates a real Paper (run in
 * the Paper runner: timed, question by question, mistakes, score trend) and
 * links it to the calendar block. Nothing here knows any subject by name.
 */

export interface PaperSlot {
  ruleId: ID;
  ruleTitle: string;
  date: DateKey;
  block: ScheduleBlock | null;
  subjects: Tracker[];
  defaultQuestions: number;
  durationMinutes: number;
  paper: Paper | null;
}

export async function upcomingPaperSlots(today: DateKey, horizonDays = 14): Promise<PaperSlot[]> {
  const [rules, cycles, trackers] = await Promise.all([db.recurringRules.toArray(), loadCycles(), db.trackers.toArray()]);
  const byId = new Map(trackers.map((t) => [t.id, t]));
  const slots: PaperSlot[] = [];
  for (const rule of rules) {
    const tpl = rule.blockTemplate;
    if (!rule.active || !tpl?.paperSubjects?.length) continue;
    const subjects = tpl.paperSubjects.map((id) => byId.get(id)).filter((t): t is Tracker => !!t && !t.archived);
    const blocks = await db.blocks.where('recurringRuleId').equals(rule.id).toArray();
    for (let i = 0; i < horizonDays; i++) {
      const date = addDaysToKey(today, i);
      if (!ruleFiresOn(rule, date, cycles)) continue;
      const block = blocks.find((b) => (b.occurrenceDate ?? b.date) === date && b.status !== 'cancelled') ?? null;
      const paper = block?.paperId ? (await db.papers.get(block.paperId)) ?? null : null;
      slots.push({
        ruleId: rule.id, ruleTitle: rule.title, date, block, subjects,
        defaultQuestions: tpl.paperQuestions ?? 30,
        durationMinutes: block ? Math.round((block.end - block.start) / 60_000) : tpl.durationMinutes,
        paper,
      });
    }
  }
  return slots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Assigns a subject to a slot: creates its Paper and links it to the block.
 * Re-assigning replaces a paper that has not been started; a started or
 * submitted paper is never thrown away.
 */
export async function assignPaper(slot: PaperSlot, subjectId: ID, questions: number): Promise<{ ok: boolean; message: string; paper?: Paper }> {
  if (!slot.block) return { ok: false, message: 'This day has no calendar block yet — open the Schedule once to generate it.' };
  if (slot.paper && slot.paper.status !== 'draft') return { ok: false, message: 'That paper has already been started.' };
  const subject = slot.subjects.find((s) => s.id === subjectId);
  if (!subject) return { ok: false, message: 'Pick one of the listed subjects.' };
  if (slot.paper) await deletePaper(slot.paper.id);

  const paper = await createPaper({
    title: `${subject.name} — ${slot.ruleTitle}`,
    sections: [{ name: subject.name, trackerId: subject.id, questionCount: Math.max(1, Math.round(questions)), marksPerQuestion: 1, negativeMarks: 0 }],
    durationMinutes: slot.durationMinutes,
    timed: true,
    date: slot.date,
  });
  const base = slot.ruleTitle;
  await db.blocks.update(slot.block.id, { paperId: paper.id, title: `${base} — ${subject.name}`, updatedAt: Date.now() });
  return { ok: true, message: `${subject.name} paper planned for ${slot.date}.`, paper };
}
