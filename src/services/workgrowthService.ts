import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { todayKey } from '@/lib/date';
import { logActivity } from './activityService';
import { balanceDue } from '@/engines/workgrowth';
import { createGoal } from './goalService';
import type { DateKey, ID } from '@/types';
import type {
  Contact, ContactInteraction, ExamTrack, ScoreEntry, ContactStage, MoneyEntry, MoneyPayment, MoneyStatus, Skill, SkillEvidence, SkillLevel,
  Source, SourceStatus, Study, StudyKind,
} from '@/types/workgrowth';

/* ================================================================== */
/* Earning — contacts (leads → clients) and the money ledger           */
/* ================================================================== */

export type ContactDraft = Partial<Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>> & { name: string };

export async function createContact(draft: ContactDraft, now = Date.now()): Promise<Contact> {
  const c: Contact = {
    id: newId('con'), createdAt: now, updatedAt: now,
    stage: 'lead', tags: [], interactions: [],
    ...draft,
    name: draft.name.trim(),
  };
  await db.contacts.add(c);
  return c;
}

export async function updateContact(id: ID, patch: Partial<Contact>): Promise<void> {
  await db.contacts.update(id, { ...patch, updatedAt: Date.now() });
}

/** Moves a contact along the pipeline and records it on the timeline. */
export async function setContactStage(id: ID, stage: ContactStage, note?: string): Promise<void> {
  const c = await db.contacts.get(id);
  if (!c || c.stage === stage) return;
  const entry: ContactInteraction = { id: newId('int'), at: Date.now(), kind: 'note', summary: note ?? `Stage: ${c.stage} → ${stage}` };
  await updateContact(id, { stage, interactions: [entry, ...c.interactions] });
}

export async function logInteraction(id: ID, kind: ContactInteraction['kind'], summary: string, nextFollowUp?: DateKey | null): Promise<void> {
  const c = await db.contacts.get(id);
  if (!c) return;
  const entry: ContactInteraction = { id: newId('int'), at: Date.now(), kind, summary };
  await updateContact(id, {
    interactions: [entry, ...c.interactions],
    ...(nextFollowUp !== undefined ? { nextFollowUp } : {}),
    ...(c.stage === 'lead' && kind !== 'note' ? { stage: 'contacted' as ContactStage } : {}),
  });
}

export async function deleteContact(id: ID): Promise<void> {
  await db.contacts.delete(id);
}

export type MoneyDraft = Omit<MoneyEntry, 'id' | 'createdAt' | 'updatedAt' | 'currency' | 'status'> & {
  currency?: string;
  status?: MoneyStatus;
};

export async function addMoney(draft: MoneyDraft, now = Date.now()): Promise<MoneyEntry> {
  const e: MoneyEntry = {
    id: newId('mny'), createdAt: now, updatedAt: now,
    currency: 'INR',
    status: draft.direction === 'expense' ? 'paid' : 'paid',
    ...draft,
    amount: Math.abs(draft.amount),
    stream: draft.direction === 'income' ? (draft.stream ?? 'active') : undefined,
  };
  if (e.status === 'paid' && !e.paidDate) e.paidDate = e.date;
  await db.money.add(e);
  if (e.direction === 'income' && e.status === 'paid') await logPayment(e, now);
  return e;
}

export async function updateMoney(id: ID, patch: Partial<MoneyEntry>): Promise<void> {
  await db.money.update(id, { ...patch, updatedAt: Date.now() });
}

/**
 * Marks an entry paid (today by default). With instalments already recorded,
 * the remaining balance is recorded as the final instalment, so the logged
 * payments always add up to the amount.
 */
export async function markPaid(id: ID, paidDate: DateKey = todayKey()): Promise<void> {
  const e = await db.money.get(id);
  if (!e || e.status === 'paid' || e.status === 'cancelled') return;
  if (e.payments?.length) {
    const rest = balanceDue(e);
    if (rest > 0) { await recordPayment(id, { amount: rest, date: paidDate, note: 'Final payment' }); return; }
    await updateMoney(id, { status: 'paid', paidDate });
    return;
  }
  await updateMoney(id, { status: 'paid', paidDate });
  await logPayment({ ...e, status: 'paid', paidDate }, Date.now());
}

export interface PaymentDraft { amount: number; date?: DateKey; note?: string; method?: string }

/**
 * Records a partial payment (instalment) against an income or expense entry.
 * Logs a real `payment_received` event for income, for exactly this amount.
 * When instalments reach the full amount the entry becomes `paid`.
 * Overpayment is refused rather than silently absorbed.
 */
export async function recordPayment(id: ID, draft: PaymentDraft, now = Date.now()): Promise<MoneyPayment | null> {
  const e = await db.money.get(id);
  if (!e || e.status === 'cancelled') return null;
  const amount = Math.round(Math.abs(draft.amount) * 100) / 100;
  if (!(amount > 0)) throw new Error('Enter an amount above zero.');
  // An entry already marked paid without instalments has nothing left to pay.
  const existing = e.payments ?? (e.status === 'paid' ? [{ id: newId('pay'), date: e.paidDate ?? e.date, amount: e.amount }] : []);
  const owed = Math.max(0, e.amount - existing.reduce((a, p) => a + p.amount, 0));
  if (amount > owed + 0.005) throw new Error(`Only ${owed.toLocaleString()} ${e.currency} is still owed.`);
  const pay: MoneyPayment = { id: newId('pay'), date: draft.date ?? todayKey(now), amount, note: draft.note?.trim() || undefined, method: draft.method?.trim() || undefined };
  const payments = [...existing, pay].sort((a, b) => a.date.localeCompare(b.date));
  const settled = payments.reduce((a, p) => a + p.amount, 0) >= e.amount - 0.005;
  await db.money.update(id, {
    payments,
    status: settled ? 'paid' : (e.status === 'expected' ? 'invoiced' : e.status),
    paidDate: settled ? pay.date : e.paidDate ?? null,
    updatedAt: now,
  });
  if (e.direction === 'income') {
    await logActivity({
      type: 'payment_received', title: `${e.description || e.category}${settled ? '' : ' (part)'}`, at: now,
      value: amount, unit: e.currency,
      meta: { moneyId: e.id, paymentId: pay.id, partial: !settled, stream: e.stream ?? 'active', contactId: e.contactId ?? null, projectId: e.projectId ?? null },
    });
  }
  return pay;
}

/** Removes one instalment (and its logged event). Re-opens the entry if it is no longer covered. */
export async function deletePayment(id: ID, paymentId: ID): Promise<void> {
  const e = await db.money.get(id);
  if (!e?.payments) return;
  const payments = e.payments.filter((p) => p.id !== paymentId);
  const covered = payments.reduce((a, p) => a + p.amount, 0) >= e.amount - 0.005;
  await db.money.update(id, {
    payments,
    status: covered ? 'paid' : e.status === 'paid' ? 'invoiced' : e.status,
    paidDate: covered ? payments[payments.length - 1]?.date ?? null : null,
    updatedAt: Date.now(),
  });
  const acts = (await db.activities.where('type').equals('payment_received').toArray()).filter((a) => a.meta?.paymentId === paymentId);
  await db.activities.bulkDelete(acts.map((a) => a.id));
}

export async function deleteMoney(id: ID): Promise<void> {
  await db.money.delete(id);
  const acts = (await db.activities.where('type').equals('payment_received').toArray()).filter((a) => a.meta?.moneyId === id);
  await db.activities.bulkDelete(acts.map((a) => a.id));
}

async function logPayment(e: MoneyEntry, at: number): Promise<void> {
  await logActivity({
    type: 'payment_received', title: e.description || e.category, at,
    value: e.amount, unit: e.currency,
    meta: { moneyId: e.id, stream: e.stream ?? 'active', contactId: e.contactId ?? null, projectId: e.projectId ?? null },
  });
}

/* ================================================================== */
/* Skills                                                              */
/* ================================================================== */

export type SkillDraft = Partial<Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>> & { name: string };

export async function createSkill(draft: SkillDraft, now = Date.now()): Promise<Skill> {
  const s: Skill = {
    id: newId('skl'), createdAt: now, updatedAt: now,
    category: 'General', level: 0, targetLevel: 3, path: [], evidence: [], sortOrder: await db.skills.count(),
    ...draft,
    name: draft.name.trim(),
  };
  await db.skills.add(s);
  return s;
}

export async function updateSkill(id: ID, patch: Partial<Skill>): Promise<void> {
  await db.skills.update(id, { ...patch, updatedAt: Date.now() });
}

export async function addSkillEvidence(id: ID, evidence: Omit<SkillEvidence, 'id'>): Promise<void> {
  const s = await db.skills.get(id);
  if (!s) return;
  await updateSkill(id, { evidence: [{ ...evidence, id: newId('evd') }, ...s.evidence] });
  await logActivity({ type: 'skill_evidence', title: `${s.name}: ${evidence.title}`, trackerId: s.trackerId ?? null, meta: { skillId: id, kind: evidence.kind } });
}

export async function setSkillLevel(id: ID, level: SkillLevel): Promise<void> {
  await updateSkill(id, { level });
}

export async function toggleSkillPathItem(id: ID, itemId: ID): Promise<void> {
  const s = await db.skills.get(id);
  if (!s) return;
  await updateSkill(id, { path: s.path.map((p) => (p.id === itemId ? { ...p, doneAt: p.doneAt ? null : Date.now() } : p)) });
}

export async function deleteSkill(id: ID): Promise<void> {
  await db.skills.delete(id);
}

/* ================================================================== */
/* Research — studies (reviews, papers) and the literature library    */
/* ================================================================== */

export const REVIEW_SECTIONS = ['Introduction & question', 'Search method', 'Thematic synthesis', 'Discussion & gaps', 'Limitations', 'References'];
export const PAPER_SECTIONS = ['Abstract', 'Introduction', 'Literature review', 'Method', 'Results', 'Discussion', 'Limitations', 'Conclusion', 'References'];

export interface StudyDraft {
  title: string;
  kind: StudyKind;
  question?: string;
  targetDate?: DateKey | null;
  themes?: string[];
  trackerId?: ID;
  goalId?: ID;
  sections?: string[];
}

export async function createStudy(draft: StudyDraft, now = Date.now()): Promise<Study> {
  const goalId = draft.goalId ?? (await createGoal({
    title: draft.title, description: draft.question, type: 'milestone',
    trackerId: draft.trackerId ?? 'trk_study', targetDate: draft.targetDate ?? null,
  })).id;
  const sections = draft.sections ?? (draft.kind === 'literature_review' ? REVIEW_SECTIONS : PAPER_SECTIONS);
  const study: Study = {
    id: newId('std'), createdAt: now, updatedAt: now,
    title: draft.title.trim(), kind: draft.kind, stage: 'planning', goalId,
    question: draft.question, themes: draft.themes ?? [],
    sections: sections.map((title) => ({ id: newId('sec'), title, status: 'todo' })),
    targetDate: draft.targetDate ?? null, sortOrder: await db.studies.count(),
  };
  await db.studies.add(study);
  return study;
}

export async function updateStudy(id: ID, patch: Partial<Study>): Promise<void> {
  await db.studies.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteStudy(id: ID): Promise<void> {
  await db.studies.delete(id);
  const linked = await db.sources.where('studyIds').equals(id).toArray();
  for (const s of linked) await db.sources.update(s.id, { studyIds: s.studyIds.filter((x) => x !== id), updatedAt: Date.now() });
}

export type SourceDraft = Partial<Omit<Source, 'id' | 'createdAt' | 'updatedAt'>> & { title: string };

export async function createSource(draft: SourceDraft, now = Date.now()): Promise<Source> {
  const s: Source = {
    id: newId('src'), createdAt: now, updatedAt: now,
    studyIds: [], status: 'to_read', themes: [],
    ...draft,
    title: draft.title.trim(),
  };
  await db.sources.add(s);
  return s;
}

export async function updateSource(id: ID, patch: Partial<Source>): Promise<void> {
  const before = await db.sources.get(id);
  await db.sources.update(id, { ...patch, updatedAt: Date.now() });
  const becameRead = before && patch.status && (patch.status === 'read' || patch.status === 'extracted')
    && before.status !== 'read' && before.status !== 'extracted';
  if (becameRead) {
    await db.sources.update(id, { readAt: Date.now() });
    await logActivity({ type: 'source_read', title: before!.title, meta: { sourceId: id, studyIds: before!.studyIds } });
  }
}

export async function setSourceStatus(id: ID, status: SourceStatus): Promise<void> {
  await updateSource(id, { status });
}

export async function deleteSource(id: ID): Promise<void> {
  await db.sources.delete(id);
}

/** Parses a pasted reference line "Author (2021). Title. Venue." into a draft — best effort. */
export function parseReference(text: string): SourceDraft {
  const t = text.trim();
  const doi = /\b(10\.\d{4,9}\/[^\s]+)\b/i.exec(t)?.[1];
  const url = /(https?:\/\/[^\s]+)/i.exec(t)?.[1];
  const yearMatch = /\((\d{4})\)|\b(19|20)\d{2}\b/.exec(t);
  const year = yearMatch ? Number(yearMatch[1] ?? yearMatch[0]) : undefined;
  let authors: string | undefined;
  let title = t;
  const m = /^(.+?)\s*\(\d{4}\)\.?\s*(.+?)(?:\.\s+(.*))?$/.exec(t);
  if (m) {
    authors = m[1]!.trim();
    title = m[2]!.trim();
  }
  return { title: title.replace(/\.$/, ''), authors, year, doi, url };
}

/* ================================================================== */
/* Exam tracks and score log                                           */
/* ================================================================== */

export type ExamTrackDraft = Partial<Omit<ExamTrack, 'id' | 'createdAt' | 'updatedAt'>> & { title: string; sections: ExamTrack['sections'] };

export async function createExamTrack(draft: ExamTrackDraft, now = Date.now()): Promise<ExamTrack> {
  const t: ExamTrack = { id: newId('exm'), createdAt: now, updatedAt: now, sortOrder: await db.examTracks.count(), ...draft };
  await db.examTracks.add(t);
  return t;
}

export async function updateExamTrack(id: ID, patch: Partial<ExamTrack>): Promise<void> {
  await db.examTracks.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteExamTrack(id: ID): Promise<void> {
  await db.transaction('rw', [db.examTracks, db.scores], async () => {
    await db.scores.where('trackId').equals(id).delete();
    await db.examTracks.delete(id);
  });
}

export async function addScore(entry: Omit<ScoreEntry, 'id' | 'createdAt' | 'updatedAt'>, now = Date.now()): Promise<ScoreEntry> {
  const row: ScoreEntry = { id: newId('scr'), createdAt: now, updatedAt: now, ...entry };
  await db.scores.add(row);
  return row;
}

export async function deleteScore(id: ID): Promise<void> {
  await db.scores.delete(id);
}
