import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { ensureSeeded } from '@/db/seed';
import { addDaysToKey, todayKey } from '@/lib/date';
import { OPERATIONS, type AgentResult } from '@/agent/catalog';
import { dispatch, missingHandlers } from '@/agent/dispatcher';
import { validate } from '@/agent/schema';
import { buildBlock, completeBlock } from '@/services/scheduleService';
import { updateTask } from '@/services/taskService';

/**
 * End-to-end coverage of the agent API through the real dispatcher, against
 * the real services and a real (fake-indexeddb) Dexie database. Every
 * operation in the catalog must be exercised here — the last test fails if
 * one is added without coverage.
 */

const called = new Set<string>();
async function call<T = any>(op: string, input: Record<string, unknown> = {}, extra: { permission?: 'read' | 'write' | 'full'; idempotencyKey?: string } = {}): Promise<AgentResult<T>> {
  called.add(op);
  return dispatch({ op, input, client: 'test', permission: extra.permission ?? 'full', idempotencyKey: extra.idempotencyKey }) as Promise<AgentResult<T>>;
}
async function ok<T = any>(op: string, input: Record<string, unknown> = {}, extra: Parameters<typeof call>[2] = {}): Promise<T> {
  const r = await call<T>(op, input, extra);
  if (!r.ok) throw new Error(`${op} failed: ${r.error.code} ${r.error.message}`);
  return r.data;
}
const local = (date: string, hhmm: string) => `${date}T${hhmm}`;

describe('agent API — catalog integrity', () => {
  it('every operation has a handler and a valid, strict input schema', () => {
    expect(missingHandlers()).toEqual([]);
    const names = new Set<string>();
    for (const o of OPERATIONS) {
      expect(o.name).toMatch(/^[a-z0-9_]{3,64}$/);
      expect(names.has(o.name)).toBe(false);
      names.add(o.name);
      expect(o.input.type).toBe('object');
      expect(o.input.additionalProperties).toBe(false);
      expect(o.description.length).toBeGreaterThan(10);
      if (o.kind === 'destructive') expect(o.input.required).toContain('confirm');
    }
  });

  it('validator catches wrong types, enums, formats and unknown fields', () => {
    const def = OPERATIONS.find((o) => o.name === 'tasks_create')!;
    expect(validate(def.input, { title: 'x', trackerId: 't' })).toEqual([]);
    expect(validate(def.input, { title: 'x' }).map((x) => x.path)).toContain('$.trackerId');
    expect(validate(def.input, { title: 'x', trackerId: 't', dueDate: '19/11/2026' })[0]!.message).toMatch(/YYYY-MM-DD/);
    expect(validate(def.input, { title: 'x', trackerId: 't', basePriority: 9 })[0]!.message).toMatch(/≤ 5/);
    expect(validate(def.input, { title: 'x', trackerId: 't', bogus: 1 })[0]!.message).toMatch(/unknown field/);
    expect(validate(def.input, { title: 'x', trackerId: 't', type: 'nap' })[0]!.message).toMatch(/one of/);
  });
});

describe('agent API — end-to-end through the dispatcher', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of [...EXPORTABLE_TABLES, 'auditLog']) await db.table(name).clear();
    await ensureSeeded();
  });

  it('operates the whole app: every operation succeeds against real data', async () => {
    const today = todayKey();
    const tomorrow = addDaysToKey(today, 1);

    // System / trackers
    expect((await ok('system_info')).schemaVersion).toBeGreaterThan(0);
    const sub = await ok('trackers_create', { name: 'Agent subject', pillar: 'study', parentId: null });
    expect(sub.result).toBe('created');
    expect((await ok('trackers_create', { name: 'agent subject', pillar: 'study' })).tracker.id).toBe(sub.tracker.id);
    const trackers = await ok<any[]>('trackers_list');
    expect(trackers.length).toBeGreaterThan(0);
    const trk = trackers[0].id as string;

    // Tasks
    const task = await ok('tasks_create', { title: 'Write essay', trackerId: trk, dueDate: tomorrow, basePriority: 4, estimatedMinutes: 60, tags: ['school'] });
    expect(['inbox', 'planned']).toContain(task.status);
    const late = await ok('tasks_create', { title: 'Late thing', trackerId: trk, dueDate: addDaysToKey(today, -3) });
    expect((await ok<any[]>('tasks_list', { tag: 'school' })).map((t) => t.id)).toEqual([task.id]);
    expect((await ok('tasks_get', { id: task.id })).title).toBe('Write essay');
    expect((await ok<any[]>('tasks_overdue')).map((t) => t.id)).toContain(late.id);
    expect((await ok<any[]>('tasks_upcoming', { days: 3 })).map((t) => t.id)).toContain(task.id);
    const upd = await ok('tasks_update', { id: task.id, notes: 'Intro first', expectedUpdatedAt: task.updatedAt });
    expect(upd.notes).toBe('Intro first');
    // Stale write is refused (concurrency guard).
    const stale = await call('tasks_update', { id: task.id, notes: 'x', expectedUpdatedAt: task.updatedAt - 1 });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT');
    expect((await ok('tasks_reschedule', { id: late.id, dueDate: tomorrow })).task.dueDate).toBe(tomorrow);
    const scheduled = await ok('tasks_schedule_at', { id: task.id, start: local(tomorrow, '16:00'), minutes: 45 });
    expect(scheduled.block.taskId).toBe(task.id);
    expect((await ok('tasks_set_status', { id: late.id, status: 'completed' })).task.status).toBe('completed');

    // Schedule
    const created = await ok('schedule_create_block', { title: 'Deep work', start: local(today, '09:00'), end: local(today, '10:00'), trackerId: trk });
    const blk = created.block;
    expect(blk.start).toBe(local(today, '09:00'));
    const clash = await ok('schedule_create_block', { title: 'Overlap', start: local(today, '09:30'), end: local(today, '10:30'), trackerId: trk });
    const opt = await ok('schedule_create_block', { title: 'Free time', start: local(today, '22:00'), end: local(today, '22:30'), trackerId: trk, optional: true });
    expect(opt.block.optional).toBe(true);
    expect(opt.block.required).toBe(false);
    expect(clash.conflicts.map((c: any) => c.id)).toContain(blk.id);
    expect((await ok('schedule_get_conflicts', { from: today })).total).toBeGreaterThan(0);
    expect((await ok('schedule_get_day', { date: today })).blocks.length).toBeGreaterThanOrEqual(2);
    expect((await ok<any[]>('schedule_list_blocks', { from: today, to: tomorrow })).length).toBeGreaterThanOrEqual(3);
    expect((await ok('schedule_get_block', { id: blk.id })).id).toBe(blk.id);
    await ok('schedule_get_current');
    expect((await ok('schedule_update_block', { id: blk.id, notes: 'Chapter 3' })).notes).toBe('Chapter 3');
    const moved = await ok('schedule_reschedule_block', { id: clash.block.id, start: local(today, '11:00') });
    expect(moved.block.durationMinutes).toBe(60);
    expect(moved.conflicts).toEqual([]);

    const done = await ok('schedule_complete_block', { id: blk.id });
    expect(done.result).toBe('completed');
    expect((await ok('schedule_complete_block', { id: blk.id })).result).toBe('already_completed');
    expect((await ok<any[]>('schedule_completion_history', { from: today, to: today })).filter((h) => h.blockId === blk.id)).toHaveLength(1);
    expect((await ok('schedule_reopen_block', { id: blk.id })).result).toBe('reopened');
    expect((await ok('schedule_start_block', { id: blk.id })).result).toBe('started');
    await ok('schedule_auto_completion_status');
    await ok('schedule_run_auto_completion');
    expect((await ok('schedule_skip_block', { id: clash.block.id, reason: 'ran over' })).result).toBe('skipped');
    expect((await ok('schedule_cancel_block', { id: scheduled.block.id })).result).toBe('cancelled');
    const needsConfirm = await call('schedule_delete_block', { id: scheduled.block.id, confirm: false });
    expect(!needsConfirm.ok && needsConfirm.error.code).toBe('CONFIRMATION_REQUIRED');
    expect((await ok('schedule_delete_block', { id: scheduled.block.id, confirm: true })).result).toBe('deleted');
    expect((await ok('schedule_delete_block', { id: scheduled.block.id, confirm: true })).result).toBe('already_deleted');

    // Recurring
    const rec = await ok('recurring_create', { title: 'Gym', freq: 'weekly', byWeekday: [1, 3, 5], startTime: '06:00', durationMinutes: 60, trackerId: trk });
    expect(rec.rule.description).toBeTruthy();
    expect((await ok<any[]>('recurring_list')).map((r) => r.id)).toContain(rec.rule.id);
    const occ = (await db.blocks.where('recurringRuleId').equals(rec.rule.id).first())!;
    expect(occ).toBeTruthy();
    await ok('recurring_edit', { ruleId: rec.rule.id, occurrenceDate: occ.date, scope: 'occurrence', title: 'Gym (legs)' });
    await ok('recurring_set_active', { ruleId: rec.rule.id, active: false });
    await ok('recurring_delete', { ruleId: rec.rule.id, occurrenceDate: occ.date, scope: 'series', confirm: true });

    // Planning
    await ok('plan_preview', { from: tomorrow, days: 1 });
    await ok('plan_apply', { from: tomorrow, days: 1 });
    await ok('plan_undo_last');

    // Checklists
    const cl = await ok('checklists_create', { title: 'Morning', cadence: 'daily', items: [{ title: 'Water' }, { title: 'Stretch' }] });
    const itemId = cl.items[0].id;
    expect((await ok('checklists_set_item', { id: cl.id, itemId, checked: true })).result).toBe('changed');
    expect((await ok('checklists_set_item', { id: cl.id, itemId, checked: true })).result).toBe('unchanged');
    expect((await ok<any[]>('checklists_list', { cadence: 'daily' })).find((c) => c.id === cl.id).done).toBe(1);
    await ok('checklists_add_item', { id: cl.id, title: 'Journal' });
    await ok('checklists_update', { id: cl.id, title: 'Morning routine' });
    await ok('checklists_remove_item', { id: cl.id, itemId, confirm: true });
    await ok('checklists_delete', { id: cl.id, confirm: true });

    // Goals
    const goal = await ok('goals_create', { title: 'Ship app', type: 'milestone', trackerId: trk, milestones: ['MVP', 'Beta'] });
    expect(goal.milestones).toHaveLength(2);
    const ms = await ok('milestones_create', { goalId: goal.id, title: 'Launch' });
    await ok('milestones_update', { id: ms.id, title: 'Public launch' });
    expect((await ok('milestones_set_done', { id: goal.milestones[0].id, done: true })).result).toBe('changed');
    expect((await ok('milestones_set_done', { id: goal.milestones[0].id, done: true })).result).toBe('unchanged');
    expect((await ok('goals_get', { id: goal.id })).progress).toBeGreaterThan(0);
    expect((await ok<any[]>('goals_list')).length).toBeGreaterThan(0);
    await ok('goals_history', { id: goal.id });
    await ok('goals_update', { id: goal.id, status: 'paused' });
    await ok('milestones_delete', { id: ms.id, confirm: true });
    await ok('goals_delete', { id: goal.id, confirm: true });

    // Progress / achievements / rewards
    await ok('achievements_list');
    expect((await ok('xp_get')).level).toBeGreaterThanOrEqual(1);
    await ok('rewards_list');
    const leaf = { id: 'r', type: 'leaf', metric: 'minutes:' + trk, operator: '>=', value: 60, window: { kind: 'all_time' } };
    const ach = await ok('achievements_create', { key: 'agent_test_hour', title: 'First hour', description: 'One hour logged', category: 'study', target: 60, xpReward: 50, condition: leaf });
    expect(ach.result).toBe('created');
    expect((await ok('achievements_create', { key: 'agent_test_hour', title: 'First hour!', description: 'One hour', category: 'study', target: 60, xpReward: 60, condition: leaf })).result).toBe('updated');
    expect(((await call('achievements_create', { key: 'agent_bad', title: 'x', description: 'x', category: 'study', target: 1, xpReward: 1, condition: { ...leaf, metric: 'nonsense:abc' } })) as any).error.code).toBe('VALIDATION_ERROR');
    expect((await ok<any[]>('achievements_list', { limit: 500 })).some((a) => a.key === 'agent_test_hour' && !a.unlocked)).toBe(true);
    const rw = await ok('rewards_create', { name: 'Movie night', kind: 'redeemable', cost: 500 });
    expect(rw.reward.cost).toBe(500);
    expect((await ok('rewards_create', { name: 'movie night', kind: 'redeemable', cost: 500 })).result).toBe('already_exists');
    expect(((await call('rewards_create', { name: 'Bad', kind: 'redeemable' })) as any).error.code).toBe('VALIDATION_ERROR');
    const rewardId = (await db.rewards.toCollection().first())?.id;
    const redeem = await call('rewards_redeem', { id: rewardId ?? 'missing' });
    expect(redeem.ok || ['INVALID_STATE', 'NOT_FOUND'].includes(redeem.error.code)).toBe(true);

    // Projects
    const proj = await ok('projects_create', { title: 'Portfolio', kind: 'portfolio', status: 'active', milestones: ['Design'], deliverables: ['Landing page'] });
    await ok('projects_add_task', { id: proj.id, title: 'Hero section' });
    await ok('projects_add_deliverable', { id: proj.id, title: 'Case study' });
    const del = await ok('projects_set_deliverable', { id: proj.id, deliverableId: proj.deliverables[0].id, done: true });
    expect(del.deliverables[0].done).toBe(true);
    await ok('projects_update', { id: proj.id, status: 'testing' });
    expect((await ok('projects_get', { id: proj.id })).status).toBe('testing');
    expect((await ok<any[]>('projects_list')).length).toBe(1);
    await ok('projects_delete', { id: proj.id, confirm: true });

    // Skills
    const sk = await ok('skills_create', { name: 'Networking', level: 1, targetLevel: 3 });
    await ok('skills_update', { id: sk.id, notes: 'CCNA' });
    expect((await ok('skills_set_level', { id: sk.id, level: 2 })).level).toBe(2);
    await ok('skills_add_evidence', { id: sk.id, title: 'Packet Tracer lab', kind: 'lab' });
    const withPath = await ok('skills_add_path_item', { id: sk.id, title: 'Subnetting' });
    expect((await ok('skills_set_path_item', { id: sk.id, itemId: withPath.path[0].id, done: true })).path[0].doneAt).not.toBeNull();
    expect((await ok<any[]>('skills_list'))[0].gap).toBe(1);
    await ok('skills_delete', { id: sk.id, confirm: true });

    // Earning
    const con = await ok('contacts_create', { name: 'Acme', stage: 'lead', dealValue: 500 });
    await ok('contacts_update', { id: con.id, company: 'Acme Inc' });
    expect((await ok('contacts_set_stage', { id: con.id, stage: 'proposal' })).stage).toBe('proposal');
    await ok('contacts_log_interaction', { id: con.id, kind: 'call', summary: 'Intro call', nextFollowUp: tomorrow });
    expect((await ok<any[]>('contacts_list', { stage: ['proposal'] })).length).toBe(1);
    const inv = await ok('money_add', { date: today, direction: 'income', amount: 1000, category: 'Client work', status: 'invoiced', contactId: con.id });
    const part = await ok('money_record_payment', { id: inv.id, amount: 400 });
    expect(part.balanceDue).toBe(600);
    const over = await call('money_record_payment', { id: inv.id, amount: 5000 });
    expect(!over.ok && over.error.code).toBe('INVALID_STATE');
    await ok('money_update', { id: inv.id, description: 'Website' });
    const payId = (await db.money.get(inv.id))!.payments![0].id;
    await ok('money_delete_payment', { id: inv.id, paymentId: payId, confirm: true });
    expect((await ok('money_mark_paid', { id: inv.id })).result).toBe('paid');
    expect((await ok('money_mark_paid', { id: inv.id })).result).toBe('already_paid');
    expect((await ok<any[]>('money_list', { direction: 'income' })).length).toBe(1);
    expect((await ok('earning_summary', { from: today, to: today })).revenue ?? 0).toBeGreaterThanOrEqual(0);
    await ok('money_delete', { id: inv.id, confirm: true });
    await ok('contacts_delete', { id: con.id, confirm: true });

    // Research
    const st = await ok('studies_create', { title: 'Phishing review', kind: 'literature_review', themes: ['training'], sections: ['Intro'] });
    await ok('studies_update', { id: st.id, stage: 'reading', question: 'Does training work?' });
    const withSec = await ok('studies_set_section', { id: st.id, title: 'Methods' });
    await ok('studies_set_section', { id: st.id, sectionId: withSec.sections[0].id, status: 'draft', words: 300 });
    const src = await ok('sources_create', { title: 'Phishing at scale', year: 2023, studyIds: [st.id], themes: ['training'] });
    await ok('sources_update', { id: src.id, status: 'extracted', findings: 'Training reduces clicks' });
    expect((await ok<any[]>('sources_list', { studyId: st.id })).length).toBe(1);
    expect((await ok('studies_get', { id: st.id })).progress.extracted).toBe(1);
    expect((await ok<any[]>('studies_list')).length).toBe(1);
    await ok('sources_delete', { id: src.id, confirm: true });
    await ok('studies_delete', { id: st.id, confirm: true });

    // Exams
    await ok('exams_list');
    const badScore = await call('exams_add_score', { trackId: 'nope', date: today, label: 'PT1', kind: 'practice' });
    expect(!badScore.ok && badScore.error.code).toBe('NOT_FOUND');
    const trackId = 'trk_exam_test';
    await db.examTracks.add({ id: trackId, createdAt: 1, updatedAt: 1, title: 'SAT', sections: [{ id: 'rw', label: 'R&W', min: 200, max: 800 }, { id: 'math', label: 'Math', min: 200, max: 800 }] as never, sortOrder: 0 });
    expect((await ok('exams_add_score', { trackId, date: today, label: 'PT1', kind: 'practice', sections: { rw: 650, math: 700 } })).total).toBe(1350);

    // Habits
    await ok('habits_list');
    const hab = await call('habits_check_in', { id: 'missing' });
    expect(!hab.ok && hab.error.code).toBe('NOT_FOUND');
    await db.habits.add({ id: 'hab_t', createdAt: 1, updatedAt: 1, title: 'Read', trackerId: trk, goalId: null, cadence: 'daily', targetPerPeriod: 1, targetValue: null, archived: false, currentStreak: 0, longestStreak: 0, lastCheckinDate: null } as never);
    await ok('habits_check_in', { id: 'hab_t' });
    await ok('habits_undo_check_in', { id: 'hab_t' });

    // Focus / analytics / overview
    await ok('focus_sessions', { from: today, to: today });
    await ok('focus_status');
    expect((await ok('analytics_summary', { from: addDaysToKey(today, -6), to: today })).days).toBe(7);
    await ok('analytics_time_allocation', { from: today, to: today });
    expect((await ok('analytics_streaks', { days: 14 })).series).toHaveLength(14);
    await ok('analytics_daily_review', { date: today });
    await ok('analytics_weekly_review', { from: addDaysToKey(today, -6), to: today });
    expect((await ok<any[]>('activity_list')).some((a) => a.source === 'agent')).toBe(true);
    const dash = await ok('dashboard_get');
    expect(dash.progress.blocks).toBeDefined();
    for (const period of ['day', 'week', 'month']) await ok('progress_get', { period });

    // Settings
    expect((await ok('settings_update', { mode: 'advanced', theme: 'dark' })).mode).toBe('advanced');
    expect((await ok('settings_get')).theme).toBe('dark');
    expect((await ok('notifications_update_prefs', { leadMinutes: 10 })).reminders.leadMinutes).toBe(10);
    await ok('notifications_get_prefs');

    // Audit
    const log = await ok<any[]>('audit_log', { limit: 500 });
    expect(log.length).toBeGreaterThan(20);
    expect(log.every((e) => e.source === 'agent')).toBe(true);
    expect(log.some((e) => !e.ok && e.errorCode === 'CONFLICT')).toBe(true);
  }, 30_000);

  it('enforces permission levels', async () => {
    const r = await call('tasks_create', { title: 'x', trackerId: 'y' }, { permission: 'read' });
    expect(!r.ok && r.error.code).toBe('PERMISSION_DENIED');
    const d = await call('tasks_delete', { id: 'x', confirm: true }, { permission: 'write' });
    expect(!d.ok && d.error.code).toBe('PERMISSION_DENIED');
    expect((await call('tasks_list', {}, { permission: 'read' })).ok).toBe(true);
  });

  it('replays a mutation with the same idempotency key instead of repeating it', async () => {
    const trk = (await db.trackers.toArray())[0]!.id;
    const a = await ok('tasks_create', { title: 'Once', trackerId: trk }, { idempotencyKey: 'k-1' });
    const r = await call('tasks_create', { title: 'Once', trackerId: trk }, { idempotencyKey: 'k-1' });
    expect(r.ok && (r.data as any).id).toBe(a.id);
    expect(r.ok && r.meta?.replayed).toBe(true);
    expect(await db.tasks.filter((t) => t.title === 'Once').count()).toBe(1);
  });

  it('reports unknown operations and validation errors with stable codes', async () => {
    const u = await dispatch({ op: 'nope', permission: 'full' });
    expect(!u.ok && u.error.code).toBe('UNKNOWN_OPERATION');
    const v = await call('schedule_create_block', { title: 'x', start: 'tomorrow', end: 'later', trackerId: 't' });
    expect(!v.ok && v.error.code).toBe('VALIDATION_ERROR');
    const n = await call('schedule_complete_block', { id: 'blk_missing' });
    expect(!n.ok && n.error.code).toBe('NOT_FOUND');
  });

  it('agent and frontend edits on the same record stay consistent', async () => {
    const trk = (await db.trackers.toArray())[0]!.id;
    const t = await ok('tasks_create', { title: 'Shared', trackerId: trk });
    // The user edits in the app…
    await updateTask(t.id, { notes: 'user edit' });
    // …so an agent write based on the stale read is refused,
    const r = await call('tasks_update', { id: t.id, notes: 'agent edit', expectedUpdatedAt: t.updatedAt });
    expect(!r.ok && r.error.code).toBe('CONFLICT');
    expect((await db.tasks.get(t.id))!.notes).toBe('user edit');
    // and a block completed by the user and the agent at once is completed once.
    const start = Date.now() - 3_600_000;
    const b = buildBlock({ trackerId: trk, title: 'Both', kind: 'fixed', start, end: start + 30 * 60_000 });
    await db.blocks.add(b);
    const [user, agent] = await Promise.all([completeBlock(b.id), call('schedule_complete_block', { id: b.id })]);
    const statuses = [user.status, agent.ok ? (agent.data as any).result : 'error'];
    expect(statuses.filter((x) => x === 'completed')).toHaveLength(1);
    expect(await db.activities.where('blockId').equals(b.id).filter((a) => a.type === 'block_completed').count()).toBe(1);
  });

  it('covers every operation in the catalog', () => {
    const uncovered = OPERATIONS.map((o) => o.name).filter((n) => !called.has(n));
    expect(uncovered).toEqual([]);
  });
});
