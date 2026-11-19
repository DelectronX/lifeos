import type { BaseEntity, DateKey, ID, Timestamp } from './index';

/**
 * Work & Growth modules. Every module rides on the shared LifeOS backbone:
 *
 *   Goal → Milestones → Tasks → Scheduled blocks → Completion → XP → Achievements
 *
 * A Project or a Research study OWNS a goal (`goalId`): its milestones and
 * tasks are ordinary Milestone/Task rows of that goal, so Auto Plan, the
 * schedule, XP and achievements work on them with no special cases. Nothing
 * here duplicates a task system.
 */

/* ------------------------------------------------------------------ */
/* Checklists                                                          */
/* ------------------------------------------------------------------ */

export type ChecklistCadence = 'daily' | 'weekly' | 'monthly';

export interface ChecklistItem {
  id: ID;
  title: string;
  /** What "done" means for this item. */
  doneDefinition?: string;
  /** Free text such as "Before 07:30" or "Month-end". */
  timing?: string;
  /** Optional area tag (e.g. "SAT", "Research"). */
  area?: string;
  /** Only on these weekdays (0 = Sunday) for a daily list. Empty/absent = every day. */
  days?: number[];
}

export interface Checklist extends BaseEntity {
  title: string;
  cadence: ChecklistCadence;
  description?: string;
  items: ChecklistItem[];
  active: boolean;
  sortOrder: number;
  /** Weekly lists: the weekday it is "due" (0 = Sunday). Monthly: day of month, or 'last'. */
  dueWeekday?: number;
  dueMonthDay?: number | 'last';
  /** XP banked once per period when EVERY item is ticked (revoked if un-ticked). */
  completionXP?: number;
  trackerId?: ID | null;
}

/** One period's ticks for one checklist (period = date, ISO week or month). */
export interface ChecklistRun extends BaseEntity {
  checklistId: ID;
  /** "2026-11-18" (daily), "2026-W47" (weekly), "2026-11" (monthly). */
  periodKey: string;
  /** itemId → when it was ticked. */
  checked: Record<ID, Timestamp>;
  completedAt: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export type ProjectStatus = 'idea' | 'planning' | 'active' | 'testing' | 'shipped' | 'paused' | 'archived';
export type ProjectKind = 'portfolio' | 'client' | 'app' | 'research' | 'course' | 'personal';

export interface ProjectDeliverable {
  id: ID;
  title: string;
  doneAt: Timestamp | null;
}

export interface ProjectLink {
  id: ID;
  label: string;
  url: string;
}

export interface Project extends BaseEntity {
  title: string;
  summary?: string;
  kind: ProjectKind;
  status: ProjectStatus;
  /** The backbone goal: milestones + tasks live under it. */
  goalId: ID;
  clientId?: ID | null;
  studyId?: ID | null;
  skillIds?: ID[];
  repoUrl?: string;
  demoUrl?: string;
  links?: ProjectLink[];
  startDate?: DateKey | null;
  targetDate?: DateKey | null;
  deliverables: ProjectDeliverable[];
  /** Definition of done, shown on the workspace. */
  definitionOfDone?: string;
  notes?: string;
  /** Portfolio write-up (problem → solution → stack → role → results). */
  portfolio?: { problem?: string; solution?: string; stack?: string; role?: string; results?: string };
  sortOrder: number;
}

/* ------------------------------------------------------------------ */
/* Earning — CRM + money ledger                                        */
/* ------------------------------------------------------------------ */

export type ContactStage =
  | 'lead' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'client';

export interface ContactInteraction {
  id: ID;
  at: Timestamp;
  kind: 'note' | 'call' | 'email' | 'message' | 'meeting' | 'proposal';
  summary: string;
}

export interface Contact extends BaseEntity {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  website?: string;
  /** Where the lead came from (referral, LinkedIn, Upwork…). */
  source?: string;
  stage: ContactStage;
  /** Estimated deal value (base currency). */
  dealValue?: number;
  /** Service offered / requested. */
  service?: string;
  nextFollowUp?: DateKey | null;
  tags: string[];
  notes?: string;
  interactions: ContactInteraction[];
  lostReason?: string;
}

export type MoneyDirection = 'income' | 'expense';
export type IncomeStream = 'active' | 'passive';
export type MoneyStatus = 'expected' | 'invoiced' | 'paid' | 'overdue' | 'cancelled';

export interface MoneyEntry extends BaseEntity {
  date: DateKey;
  direction: MoneyDirection;
  /** Positive amount in `currency`. */
  amount: number;
  currency: string;
  /** Income only: active (client work, freelance hours) or passive (products, royalties, interest). */
  stream?: IncomeStream;
  category: string;
  description: string;
  status: MoneyStatus;
  /** Invoice due date, when status is invoiced. */
  dueDate?: DateKey | null;
  paidDate?: DateKey | null;
  contactId?: ID | null;
  projectId?: ID | null;
  /** Hours billed, for an effective hourly rate. */
  hours?: number;
  invoiceNumber?: string;
  /**
   * Instalments received against this entry. When present they are the
   * source of truth for what has been paid (revenue is recognised on each
   * payment's date); the entry becomes `paid` once they cover `amount`.
   */
  payments?: MoneyPayment[];
}

export interface MoneyPayment {
  id: ID;
  date: DateKey;
  amount: number;
  note?: string;
  method?: string;
}

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

/** 0 unfamiliar · 1 beginner · 2 working · 3 proficient · 4 advanced · 5 expert. */
export type SkillLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface SkillEvidence {
  id: ID;
  date: DateKey;
  title: string;
  kind: 'lab' | 'project' | 'course' | 'certificate' | 'problem_set' | 'writeup' | 'assessment' | 'other';
  url?: string;
  note?: string;
}

export interface Skill extends BaseEntity {
  name: string;
  category: string;
  level: SkillLevel;
  targetLevel: SkillLevel;
  /** Tracker whose logged time counts as practice of this skill. */
  trackerId?: ID | null;
  /** Learning resources / path, in order. */
  path: Array<{ id: ID; title: string; url?: string; doneAt: Timestamp | null }>;
  evidence: SkillEvidence[];
  notes?: string;
  sortOrder: number;
}

/* ------------------------------------------------------------------ */
/* Research                                                            */
/* ------------------------------------------------------------------ */

export type StudyKind = 'literature_review' | 'paper' | 'experiment';
export type StudyStage =
  | 'planning' | 'searching' | 'screening' | 'reading' | 'synthesis' | 'writing' | 'revising' | 'submitted' | 'published';

export interface ManuscriptSection {
  id: ID;
  title: string;
  status: 'todo' | 'outline' | 'draft' | 'revised' | 'done';
  targetWords?: number;
  words?: number;
}

export interface Study extends BaseEntity {
  title: string;
  kind: StudyKind;
  stage: StudyStage;
  /** Backbone goal: milestones + tasks. */
  goalId: ID;
  question?: string;
  scope?: string;
  /** Search strategy: databases, keywords, inclusion/exclusion. */
  searchStrategy?: string;
  themes: string[];
  sections: ManuscriptSection[];
  targetDate?: DateKey | null;
  /** Where it was / will be submitted. */
  venue?: string;
  notes?: string;
  sortOrder: number;
}

export type SourceStatus = 'to_read' | 'skimmed' | 'read' | 'extracted' | 'excluded';

export interface Source extends BaseEntity {
  title: string;
  authors?: string;
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  /** Studies this source is used in. */
  studyIds: ID[];
  status: SourceStatus;
  /** 1–5. */
  relevance?: number;
  /** Literature-matrix columns. */
  method?: string;
  sample?: string;
  findings?: string;
  limitations?: string;
  themes: string[];
  notes?: string;
  readAt?: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* Exam tracks — score dashboards (SAT, AP, any scaled exam)           */
/* ------------------------------------------------------------------ */

export interface ExamTrackSection {
  id: ID;
  name: string;
  /** Highest score for the section (e.g. 800). */
  max: number;
  /** Lowest reportable score (e.g. 200). Default 0. */
  min?: number;
  /** Tracker whose papers/questions feed this section's domain analytics. */
  trackerId?: ID | null;
}

export interface ExamTrack extends BaseEntity {
  title: string;
  /** Free label like "SAT", "AP". */
  family?: string;
  sections: ExamTrackSection[];
  /** Composite target (sum of sections unless `scale` says otherwise). */
  target?: number;
  /** Composite range, e.g. 400–1600 or 1–5. */
  minTotal?: number;
  maxTotal?: number;
  /** When true the total is entered directly (e.g. AP 1–5) instead of summed. */
  directTotal?: boolean;
  examDate?: DateKey | null;
  goalId?: ID | null;
  notes?: string;
  sortOrder: number;
}

export interface ScoreEntry extends BaseEntity {
  trackId: ID;
  date: DateKey;
  label: string;
  kind: 'practice' | 'mock' | 'official';
  /** sectionId → score. */
  sections: Record<ID, number>;
  total: number;
  /** Optional link to a paper recorded in Practice. */
  paperId?: ID | null;
  notes?: string;
}
