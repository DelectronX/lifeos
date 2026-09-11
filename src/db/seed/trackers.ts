import { DEFAULT_TRACKERS } from '@/config/trackers';
import type { Tracker, TrackerColor } from '@/types';
import type { DemoContext } from './world';

/**
 * Trackers for the demo persona: a 12th-year student sitting a science
 * entrance exam, who also lifts, learns guitar and programming, and has a
 * couple of personal areas. Root pillars keep their canonical ids so every
 * other module (and the shipped protected-time template) still resolves.
 */

export interface SubTrackerSeed {
  id: string;
  name: string;
  parentId: string;
  color: TrackerColor;
  weeklyTargetMinutes: number;
}

export const DEMO_SUBTRACKERS: SubTrackerSeed[] = [
  // Study
  { id: 'trk_demo_maths', name: 'Mathematics', parentId: 'trk_study', color: 'indigo', weeklyTargetMinutes: 420 },
  { id: 'trk_demo_physics', name: 'Physics', parentId: 'trk_study', color: 'sky', weeklyTargetMinutes: 360 },
  { id: 'trk_demo_chemistry', name: 'Chemistry', parentId: 'trk_study', color: 'teal', weeklyTargetMinutes: 300 },
  { id: 'trk_demo_biology', name: 'Biology', parentId: 'trk_study', color: 'lime', weeklyTargetMinutes: 240 },
  { id: 'trk_demo_english', name: 'English', parentId: 'trk_study', color: 'amber', weeklyTargetMinutes: 120 },

  // Fitness
  { id: 'trk_demo_strength', name: 'Strength', parentId: 'trk_fitness', color: 'rose', weeklyTargetMinutes: 180 },
  { id: 'trk_demo_running', name: 'Running', parentId: 'trk_fitness', color: 'teal', weeklyTargetMinutes: 120 },
  { id: 'trk_demo_mobility', name: 'Mobility', parentId: 'trk_fitness', color: 'lime', weeklyTargetMinutes: 60 },

  // Skills
  { id: 'trk_demo_guitar', name: 'Guitar', parentId: 'trk_skills', color: 'violet', weeklyTargetMinutes: 150 },
  { id: 'trk_demo_coding', name: 'Programming', parentId: 'trk_skills', color: 'indigo', weeklyTargetMinutes: 180 },
  { id: 'trk_demo_writing', name: 'Writing', parentId: 'trk_skills', color: 'stone', weeklyTargetMinutes: 90 },

  // Personal
  { id: 'trk_demo_reading', name: 'Reading', parentId: 'trk_personal', color: 'amber', weeklyTargetMinutes: 120 },
  { id: 'trk_demo_journal', name: 'Journalling', parentId: 'trk_personal', color: 'stone', weeklyTargetMinutes: 60 },
  { id: 'trk_demo_family', name: 'Family & friends', parentId: 'trk_personal', color: 'rose', weeklyTargetMinutes: 180 },
];

export const STUDY_SUBJECTS = [
  'trk_demo_maths', 'trk_demo_physics', 'trk_demo_chemistry', 'trk_demo_biology', 'trk_demo_english',
] as const;

export const FITNESS_TRACKERS = ['trk_demo_strength', 'trk_demo_running', 'trk_demo_mobility'] as const;
export const SKILL_TRACKERS = ['trk_demo_guitar', 'trk_demo_coding', 'trk_demo_writing'] as const;
export const PERSONAL_TRACKERS = ['trk_demo_reading', 'trk_demo_journal', 'trk_demo_family'] as const;

/** Every non-system tracker the demo schedules real work against. */
export const WORK_TRACKERS = [
  ...STUDY_SUBJECTS, ...FITNESS_TRACKERS, ...SKILL_TRACKERS, ...PERSONAL_TRACKERS,
] as const;

export function seedTrackers(ctx: DemoContext): void {
  const createdAt = ctx.at(ctx.day(-90), 8 * 60);
  const roots: Tracker[] = DEFAULT_TRACKERS.map((seed, i) => ({
    ...seed,
    createdAt,
    updatedAt: createdAt,
    archived: false,
    sortOrder: i,
  }));

  const children: Tracker[] = DEMO_SUBTRACKERS.map((seed, i) => ({
    id: seed.id,
    createdAt,
    updatedAt: createdAt,
    name: seed.name,
    pillar: (DEFAULT_TRACKERS.find((t) => t.id === seed.parentId)?.pillar ?? 'study'),
    parentId: seed.parentId,
    color: seed.color,
    system: false,
    defaultProtected: false,
    archived: false,
    sortOrder: roots.length + i,
    weeklyTargetMinutes: seed.weeklyTargetMinutes,
  }));

  ctx.world.trackers.push(...roots, ...children);
}
