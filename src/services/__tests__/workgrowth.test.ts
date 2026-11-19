import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyConfig, validateConfig } from '@/services/configService';
import { readCustomMetric, buildContext } from '@/engines/customMetrics';
import { loadAchievementSource, loadCustomMetricInput } from '@/services/achievementService';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { ensureSeeded } from '@/db/seed';
import { createChecklist, toggleChecklistItem } from '@/services/checklistService';
import { addProjectTask, createProject, updateProject } from '@/services/projectService';
import { createMilestone } from '@/services/goalService';
import { setTaskStatus } from '@/services/taskService';
import {
  addMoney, createContact, createSource, createStudy, deletePayment, logInteraction, markPaid, parseReference, recordPayment, setContactStage, updateSource,
} from '@/services/workgrowthService';
import {
  balanceDue, checklistProgress, checklistStreak, dueDateFor, earningSummary, isPartiallyPaid, paidSoFar, periodEnd, periodKeyFor, scheduleHealth, studyProgress,
  workProgress,
} from '@/engines/workgrowth';
import type { Checklist, ChecklistRun } from '@/types/workgrowth';

async function reset() {
  await db.open();
  for (const name of EXPORTABLE_TABLES) await db.table(name).clear();
  await ensureSeeded();
}

describe('engine — periods and checklists', () => {
  it('derives period keys and ends for each cadence', () => {
    expect(periodKeyFor('daily', '2026-11-18')).toBe('2026-11-18');
    expect(periodKeyFor('weekly', '2026-11-18')).toBe('2026-W47');
    expect(periodKeyFor('monthly', '2026-11-18')).toBe('2026-11');
    expect(periodEnd('weekly', '2026-11-18')).toBe('2026-11-22'); // Sunday
    expect(periodEnd('monthly', '2026-02-10')).toBe('2026-02-28');
  });

  it('respects configured due days and per-weekday daily items', () => {
    const base = { id: 'c', createdAt: 0, updatedAt: 0, title: 't', active: true, sortOrder: 0 };
    const weekly: Checklist = { ...base, cadence: 'weekly', items: [], dueWeekday: 0 };
    const monthly: Checklist = { ...base, cadence: 'monthly', items: [], dueMonthDay: 31 };
    expect(dueDateFor(weekly, '2026-11-18')).toBe('2026-11-22');
    expect(dueDateFor(monthly, '2026-11-03')).toBe('2026-11-30');
    const daily: Checklist = { ...base, cadence: 'daily', items: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b', days: [0] }] };
    expect(checklistProgress(daily, undefined, '2026-11-18').total).toBe(1); // Wednesday
    expect(checklistProgress(daily, undefined, '2026-11-22').total).toBe(2); // Sunday
  });

  it('counts a streak of completed periods without breaking on the open one', () => {
    const list: Checklist = { id: 'c', createdAt: 0, updatedAt: 0, title: 't', cadence: 'daily', items: [{ id: 'a', title: 'a' }], active: true, sortOrder: 0 };
    const run = (k: string): ChecklistRun => ({ id: k, createdAt: 0, updatedAt: 0, checklistId: 'c', periodKey: k, checked: { a: 1 }, completedAt: 1 });
    expect(checklistStreak(list, [run('2026-11-15'), run('2026-11-16'), run('2026-11-17')], '2026-11-18')).toBe(3);
    expect(checklistStreak(list, [run('2026-11-15'), run('2026-11-17')], '2026-11-18')).toBe(1);
  });

  it('flags schedule health from progress vs elapsed time', () => {
    expect(scheduleHealth(0.5, '2026-11-01', '2026-11-30', '2026-11-15', false)).toBe('on_track');
    expect(scheduleHealth(0.1, '2026-11-01', '2026-11-30', '2026-11-25', false)).toBe('off_track');
    expect(scheduleHealth(0.3, '2026-11-01', '2026-11-30', '2026-11-15', false)).toBe('at_risk');
    expect(scheduleHealth(0.9, '2026-11-01', '2026-11-30', '2026-12-02', false)).toBe('off_track');
  });
});

describe('checklists — recurring runs and XP', () => {
  beforeEach(reset);

  it('a list recurs per period, banks XP once when complete and revokes it on untick', async () => {
    const list = await createChecklist({ title: 'Daily', cadence: 'daily', completionXP: 40, items: [{ title: 'A' }, { title: 'B' }] });
    const [a, b] = list.items;
    await toggleChecklistItem(list.id, a!.id, '2026-11-18');
    expect(await db.xp.count()).toBe(0);
    const r = await toggleChecklistItem(list.id, b!.id, '2026-11-18');
    expect(r.justCompleted).toBe(true);
    expect((await db.xp.toArray()).reduce((s, x) => s + x.amount, 0)).toBe(40);
    // Next day is a fresh, empty run.
    await toggleChecklistItem(list.id, a!.id, '2026-11-19');
    expect(await db.checklistRuns.count()).toBe(2);
    // Untick on the completed day: XP and the completion activity are revoked.
    await toggleChecklistItem(list.id, b!.id, '2026-11-18');
    expect((await db.xp.toArray()).reduce((s, x) => s + x.amount, 0)).toBe(0);
    expect((await db.activities.toArray()).filter((x) => x.type === 'checklist_completed')).toHaveLength(0);
    // Re-completing does not pay twice.
    await toggleChecklistItem(list.id, b!.id, '2026-11-18');
    await toggleChecklistItem(list.id, b!.id, '2026-11-18');
    await toggleChecklistItem(list.id, b!.id, '2026-11-18');
    expect((await db.xp.toArray()).reduce((s, x) => s + x.amount, 0)).toBe(40);
  });
});

describe('backbone — goal → milestone → task', () => {
  beforeEach(reset);

  it('completing the last task of a milestone completes it and advances the goal; reopening reverses', async () => {
    const project = await createProject({ title: 'Portfolio Project 1', trackerId: 'trk_skills' });
    const m1 = await createMilestone(project.goalId, 'Core MVP');
    await createMilestone(project.goalId, 'Tests');
    const t1 = await addProjectTask(project, 'Auth', { milestoneId: m1.id });
    const t2 = await addProjectTask(project, 'API', { milestoneId: m1.id });
    for (const t of [t1, t2]) await db.tasks.update(t.id, { createdAt: Date.now() - 600_000 });

    await setTaskStatus(t1.id, 'completed', { actualMinutes: 30 });
    expect((await db.milestones.get(m1.id))?.completedAt).toBeNull();
    await setTaskStatus(t2.id, 'completed', { actualMinutes: 30 });
    expect((await db.milestones.get(m1.id))?.completedAt).not.toBeNull();
    expect((await db.goals.get(project.goalId))?.progress).toBeCloseTo(0.5);

    const wp = workProgress(await db.milestones.where('goalId').equals(project.goalId).toArray(),
      await db.tasks.where('goalId').equals(project.goalId).toArray(), '2026-11-18');
    expect(wp.milestonesDone).toBe(1);
    expect(wp.tasksDone).toBe(2);

    const xpFor = async () => (await db.xp.toArray()).filter((x) => x.reason === 'milestone_completed').reduce((n, x) => n + x.amount, 0);
    expect(await xpFor()).toBeGreaterThan(0);

    await setTaskStatus(t2.id, 'planned');
    expect((await db.milestones.get(m1.id))?.completedAt).toBeNull();
    // Reopening the milestone revokes its XP.
    expect(await xpFor()).toBe(0);
  });

  it('shipping a project logs the event once and title edits flow to the goal', async () => {
    const p = await createProject({ title: 'App', kind: 'app' });
    await updateProject(p.id, { status: 'shipped', title: 'Play Store App' });
    await updateProject(p.id, { status: 'shipped' });
    expect((await db.activities.toArray()).filter((a) => a.type === 'project_shipped')).toHaveLength(1);
    expect((await db.goals.get(p.goalId))?.title).toBe('Play Store App');
  });
});

describe('earning — pipeline and ledger', () => {
  beforeEach(reset);

  it('summarises revenue by stream, outstanding/overdue, pipeline and win rate', async () => {
    const lead = await createContact({ name: 'Acme', dealValue: 20000 });
    await logInteraction(lead.id, 'email', 'Intro sent', '2026-11-20');
    expect((await db.contacts.get(lead.id))?.stage).toBe('contacted');
    await setContactStage(lead.id, 'proposal');
    const lost = await createContact({ name: 'Old', stage: 'lost' });
    const won = await createContact({ name: 'Client', stage: 'client' });
    expect(lost && won).toBeTruthy();

    await addMoney({ date: '2026-11-05', direction: 'income', amount: 10000, category: 'Freelance', description: 'Site', stream: 'active', hours: 20 });
    await addMoney({ date: '2026-11-06', direction: 'income', amount: 500, category: 'Template sales', description: 'Gumroad', stream: 'passive' });
    await addMoney({ date: '2026-11-07', direction: 'expense', amount: 1500, category: 'Tools', description: 'Hosting' });
    const inv = await addMoney({ date: '2026-11-01', direction: 'income', amount: 8000, category: 'Freelance', description: 'Invoice 2', status: 'invoiced', dueDate: '2026-11-10' });

    const s = earningSummary(await db.money.toArray(), await db.contacts.toArray(), '2026-11-01', '2026-11-30', '2026-11-18');
    expect(s.revenue).toBe(10500);
    expect(s.activeRevenue).toBe(10000);
    expect(s.passiveRevenue).toBe(500);
    expect(s.profit).toBe(9000);
    expect(s.outstanding).toBe(8000);
    expect(s.overdueCount).toBe(1);
    expect(s.pipelineValue).toBe(10000); // 20000 × proposal 0.5
    expect(s.winRate).toBe(0.5);
    expect(s.effectiveHourlyRate).toBe(525);

    await markPaid(inv.id, '2026-11-18');
    const s2 = earningSummary(await db.money.toArray(), await db.contacts.toArray(), '2026-11-01', '2026-11-30', '2026-11-18');
    expect(s2.outstanding).toBe(0);
    expect(s2.revenue).toBe(18500);
    expect((await db.activities.toArray()).filter((a) => a.type === 'payment_received')).toHaveLength(3);
  });
});

describe('research — studies, sources and synthesis', () => {
  beforeEach(reset);

  it('tracks reading + writing progress and finds thin themes', async () => {
    const study = await createStudy({ title: 'Literature Review 1', kind: 'literature_review', themes: ['detection', 'privacy'] });
    expect(study.sections.length).toBeGreaterThan(3);
    expect(await db.goals.get(study.goalId)).toBeTruthy();
    const s1 = await createSource({ title: 'A', studyIds: [study.id], themes: ['detection'] });
    await createSource({ title: 'B', studyIds: [study.id], themes: ['detection'] });
    await createSource({ title: 'C', studyIds: [study.id], status: 'excluded' });
    await updateSource(s1.id, { status: 'extracted' });
    expect((await db.activities.toArray()).filter((a) => a.type === 'source_read')).toHaveLength(1);

    const p = studyProgress(study, await db.sources.toArray());
    expect(p.sources).toBe(2);
    expect(p.excluded).toBe(1);
    expect(p.extracted).toBe(1);
    expect(p.progress).toBeCloseTo(0.2);
    expect(p.themes.find((t) => t.theme === 'privacy')?.sources).toBe(0);
  });

  it('parses a pasted reference', () => {
    const r = parseReference('Smith, J., & Lee, K. (2021). Detecting phishing with ML. Journal of Security. https://doi.org/10.1000/xyz123');
    expect(r.authors).toBe('Smith, J., & Lee, K.');
    expect(r.year).toBe(2021);
    expect(r.title).toBe('Detecting phishing with ML');
    expect(r.doi).toBe('10.1000/xyz123');
  });
});

describe('personal config — work & growth data', () => {
  beforeEach(reset);
  const raw = JSON.parse(readFileSync(resolve(__dirname, '../../../config/lifeos-my-schedule.json'), 'utf8'));

  it('validates and imports goals, milestones, projects, studies, skills, exams and checklists idempotently', async () => {
    const v = validateConfig(raw, { trackerIds: new Set((await db.trackers.toArray()).map((t) => t.id)) });
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    await applyConfig(raw);
    const counts = async () => ({
      goals: await db.goals.count(), milestones: await db.milestones.count(), projects: await db.projects.count(),
      studies: await db.studies.count(), skills: await db.skills.count(), exams: await db.examTracks.count(), lists: await db.checklists.count(),
    });
    const first = await counts();
    expect(first.projects).toBe(6);
    expect(first.studies).toBe(7);
    expect(first.exams).toBe(3);
    expect(first.lists).toBe(4);
    expect(first.milestones).toBeGreaterThan(60);
    expect((await db.goals.get('gol_project_1'))?.title).toBe('Portfolio Project 1');

    // User state survives a re-import: a tick, a renamed project and a reached milestone.
    await toggleChecklistItem('chk_monthly', 'chk_monthly_1', '2026-11-30');
    await updateProject('prj_portfolio_1', { title: 'Phishing URL Detector' });
    const m = (await db.milestones.where('goalId').equals('gol_lr_1').sortBy('sortOrder'))[0]!;
    const { toggleMilestone } = await import('@/services/goalService');
    await toggleMilestone(m.id);
    await applyConfig(raw);
    expect(await counts()).toEqual(first);
    expect((await db.checklistRuns.toArray())[0]?.checked.chk_monthly_1).toBeDefined();
    expect((await db.projects.get('prj_portfolio_1'))?.title).toBe('Phishing URL Detector');
    expect((await db.milestones.get(m.id))?.completedAt).not.toBeNull();
  });

  it('new achievement metrics read the module events', async () => {
    await applyConfig(raw);
    const m = (await db.milestones.where('goalId').equals('gol_lr_1').toArray())[0]!;
    const { toggleMilestone } = await import('@/services/goalService');
    await toggleMilestone(m.id);
    await addMoney({ date: '2026-11-18', direction: 'income', amount: 1500, category: 'Freelance', description: 'Logo', stream: 'active' });
    const ctx = buildContext(await loadCustomMetricInput(await loadAchievementSource()));
    expect(readCustomMetric('events:milestone_completed', ctx)).toBe(1);
    expect(readCustomMetric('earned:*', ctx)).toBe(1500);
    expect(readCustomMetric('earned:passive', ctx)).toBe(0);
    expect(readCustomMetric('checklists:monthly', ctx)).toBe(0);
  });
});

describe('earning — partial payments (instalments)', () => {
  beforeEach(reset);

  it('records instalments, recognises revenue on each payment date, and settles when covered', async () => {
    const inv = await addMoney({ date: '2026-10-20', direction: 'income', amount: 12000, category: 'Freelance', description: 'App build', status: 'invoiced', dueDate: '2026-11-30' });
    await recordPayment(inv.id, { amount: 5000, date: '2026-10-25', note: 'Advance' });
    await recordPayment(inv.id, { amount: 4000, date: '2026-11-10' });

    let e = (await db.money.get(inv.id))!;
    expect(e.status).toBe('invoiced');
    expect(paidSoFar(e)).toBe(9000);
    expect(balanceDue(e)).toBe(3000);
    expect(isPartiallyPaid(e)).toBe(true);

    const oct = earningSummary([e], [], '2026-10-01', '2026-10-31', '2026-11-18');
    const nov = earningSummary([e], [], '2026-11-01', '2026-11-30', '2026-11-18');
    expect(oct.revenue).toBe(5000);
    expect(nov.revenue).toBe(4000);
    expect(nov.outstanding).toBe(3000);

    // Each instalment is one real payment event, for exactly its amount.
    let acts = await db.activities.where('type').equals('payment_received').toArray();
    expect(acts.map((a) => a.value).sort()).toEqual([4000, 5000]);

    // Overpaying is refused rather than absorbed.
    await expect(recordPayment(inv.id, { amount: 3500, date: '2026-11-18' })).rejects.toThrow(/still owed/);

    // markPaid records only the remaining balance as the final instalment.
    await markPaid(inv.id, '2026-11-18');
    e = (await db.money.get(inv.id))!;
    expect(e.status).toBe('paid');
    expect(e.paidDate).toBe('2026-11-18');
    expect(balanceDue(e)).toBe(0);
    acts = await db.activities.where('type').equals('payment_received').toArray();
    expect(acts.reduce((a, x) => a + (x.value ?? 0), 0)).toBe(12000);
    expect(earningSummary([e], [], '2026-11-01', '2026-11-30', '2026-11-18').revenue).toBe(7000);
  });

  it('deleting an instalment removes its event and reopens a settled entry', async () => {
    const inv = await addMoney({ date: '2026-11-01', direction: 'income', amount: 2000, category: 'Freelance', description: 'Logo', status: 'invoiced' });
    const a = await recordPayment(inv.id, { amount: 1500, date: '2026-11-02' });
    const b = await recordPayment(inv.id, { amount: 500, date: '2026-11-03' });
    expect((await db.money.get(inv.id))!.status).toBe('paid');
    await deletePayment(inv.id, b!.id);
    const e = (await db.money.get(inv.id))!;
    expect(e.status).toBe('invoiced');
    expect(balanceDue(e)).toBe(500);
    const acts = await db.activities.where('type').equals('payment_received').toArray();
    expect(acts.map((x) => x.meta.paymentId)).toEqual([a!.id]);
  });

  it('entries paid in full without instalments still count as one payment', async () => {
    const e = await addMoney({ date: '2026-11-05', direction: 'income', amount: 800, category: 'Sales', description: 'Template', stream: 'passive' });
    const row = (await db.money.get(e.id))!;
    expect(paidSoFar(row)).toBe(800);
    await expect(recordPayment(e.id, { amount: 1 })).rejects.toThrow(/still owed/);
  });
});
