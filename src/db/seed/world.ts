import { addDaysToKey, atMinute, todayKey } from '@/lib/date';
import { createRng, type Rng } from './rng';
import type {
  Achievement, Activity, AnalyticsSnapshot, BackupSnapshot, CustomReward, DateKey, Goal, Habit,
  ID, Milestone, Paper, PlanRun, Question, QuestionAttempt, RecurringRule, Resource,
  RevisionEntry, RevisionPlan, RewardEarning, ScheduleBlock, ScheduleTemplate,
  Task, TimerSession, Tracker, UserProfile, XPTransaction,
} from '@/types';

/**
 * The in-memory world every seed module contributes to.
 *
 * Nothing here touches Dexie: modules build plain records (through the same
 * builders and types the app itself uses), the index writes them in one
 * transaction, and derived values (goal progress, XP, achievements, snapshots)
 * are recomputed afterwards by the real services. That is what keeps the demo
 * dataset something the app could genuinely have produced.
 */
export interface DemoWorld {
  trackers: Tracker[];
  goals: Goal[];
  milestones: Milestone[];
  tasks: Task[];
  blocks: ScheduleBlock[];
  templates: ScheduleTemplate[];
  recurringRules: RecurringRule[];
  sessions: TimerSession[];
  papers: Paper[];
  questions: Question[];
  attempts: QuestionAttempt[];
  revisionPlans: RevisionPlan[];
  revisionEntries: RevisionEntry[];
  resources: Resource[];
  habits: Habit[];
  activities: Activity[];
  xp: XPTransaction[];
  achievements: Achievement[];
  snapshots: AnalyticsSnapshot[];
  planRuns: PlanRun[];
  backups: BackupSnapshot[];
  rewards: CustomReward[];
  rewardEarnings: RewardEarning[];
  profile: UserProfile | null;
}

export function emptyWorld(): DemoWorld {
  return {
    trackers: [], goals: [], milestones: [], tasks: [], blocks: [], templates: [],
    recurringRules: [], sessions: [], papers: [], questions: [], attempts: [],
    revisionPlans: [], revisionEntries: [], resources: [], habits: [], activities: [],
    xp: [], achievements: [], snapshots: [], planRuns: [], backups: [], rewards: [],
    rewardEarnings: [], profile: null,
  };
}

/** How far back and forward the dataset reaches, in days from today. */
export const HISTORY_DAYS = 63;
export const FUTURE_DAYS = 14;

export interface DemoContext {
  rng: Rng;
  /** Today's local date key — every other date is derived from it. */
  today: DateKey;
  /** Local midnight of today, in epoch ms. */
  todayStart: number;
  /** Wall-clock "now" the dataset is generated against. */
  now: number;
  /** Every day key from -HISTORY_DAYS to +FUTURE_DAYS inclusive. */
  days: DateKey[];
  /** Past days only, oldest first (excludes today). */
  pastDays: DateKey[];
  /** Today plus every future day. */
  futureDays: DateKey[];
  /** Day key `offset` days from today (negative = past). */
  day(offset: number): DateKey;
  /** Timestamp at `minute` past midnight on `day`. */
  at(day: DateKey, minute: number): number;
  /** Stable id factory — deterministic, unlike `newId`. */
  id(prefix: string): ID;
  world: DemoWorld;
}

export function createContext(seed: number, now = Date.now()): DemoContext {
  const rng = createRng(seed);
  const today = todayKey(now);
  const days: DateKey[] = [];
  for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset++) {
    days.push(addDaysToKey(today, offset));
  }

  let counter = 0;
  const context: DemoContext = {
    rng,
    today,
    todayStart: atMinute(today, 0),
    now,
    days,
    pastDays: days.filter((d) => d < today),
    futureDays: days.filter((d) => d >= today),
    day: (offset) => addDaysToKey(today, offset),
    at: (day, minute) => atMinute(day, minute),
    id: (prefix) => {
      counter += 1;
      return `${prefix}_demo${counter.toString(36).padStart(5, '0')}`;
    },
    world: emptyWorld(),
  };
  return context;
}

/** Marks every demo row so "Clear demo data" can be precise if ever needed. */
export const DEMO_TAG = 'demo';
