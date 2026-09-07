import { db, SCHEMA_VERSION } from './db';
import { DEFAULT_TRACKERS } from '@/config/trackers';
import { ACHIEVEMENT_DEFINITIONS } from '@/config/achievements';
import { newId } from '@/lib/id';
import type { Settings, Tracker, UserProfile, WorkingHours } from '@/types';

/** 8am - 10pm every day, by default. Overridden in Settings. */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  0: [{ startMinute: 9 * 60, endMinute: 22 * 60 }],
  1: [{ startMinute: 8 * 60, endMinute: 22 * 60 }],
  2: [{ startMinute: 8 * 60, endMinute: 22 * 60 }],
  3: [{ startMinute: 8 * 60, endMinute: 22 * 60 }],
  4: [{ startMinute: 8 * 60, endMinute: 22 * 60 }],
  5: [{ startMinute: 8 * 60, endMinute: 22 * 60 }],
  6: [{ startMinute: 9 * 60, endMinute: 22 * 60 }],
};

export function createDefaultSettings(now = Date.now()): Settings {
  return {
    id: 'settings',
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    theme: 'system',
    weekStartsOn: 1,
    scheduling: {},
    workingHours: DEFAULT_WORKING_HOURS,
    focusHours: [{ startMinute: 9 * 60, endMinute: 12 * 60 }],
    notifications: {
      enabled: false,
      blockStart: true,
      breakEnd: true,
      revisionDue: true,
      dailyReviewHour: 21,
    },
    lastDailyReviewDate: null,
    lastWeeklyReviewDate: null,
  };
}

export function createDefaultProfile(now = Date.now()): UserProfile {
  return {
    id: 'profile',
    createdAt: now,
    updatedAt: now,
    displayName: '',
    totalXP: 0,
    level: 1,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: null,
    onboardedAt: null,
  };
}

/**
 * Idempotent bootstrap. Safe to call on every app start: it only fills gaps,
 * never overwrites user data.
 */
export async function ensureSeeded(): Promise<void> {
  const now = Date.now();

  await db.transaction(
    'rw',
    [db.profile, db.settings, db.trackers, db.achievements, db.templates],
    async () => {
      if (!(await db.profile.get('profile'))) {
        await db.profile.put(createDefaultProfile(now));
      }
      if (!(await db.settings.get('settings'))) {
        await db.settings.put(createDefaultSettings(now));
      }

      if ((await db.trackers.count()) === 0) {
        const rows: Tracker[] = DEFAULT_TRACKERS.map((seed, i) => ({
          ...seed,
          createdAt: now,
          updatedAt: now,
          archived: false,
          sortOrder: i,
        }));
        await db.trackers.bulkPut(rows);
      }

      // Achievement rows mirror the definition list so progress can be stored.
      const existingKeys = new Set((await db.achievements.toArray()).map((a) => a.key));
      const missing = ACHIEVEMENT_DEFINITIONS.filter((d) => !existingKeys.has(d.key)).map((d) => ({
        id: newId('ach'),
        createdAt: now,
        updatedAt: now,
        key: d.key,
        title: d.title,
        description: d.description,
        category: d.category,
        tier: d.tier,
        target: d.target,
        progress: 0,
        unlockedAt: null,
        xpReward: d.xpReward,
      }));
      if (missing.length) await db.achievements.bulkPut(missing);

      if ((await db.templates.count()) === 0) {
        await db.templates.put({
          id: newId('tpl'),
          createdAt: now,
          updatedAt: now,
          name: 'Default week',
          description: 'Protected sleep and meal times. Edit or disable in Settings.',
          active: false,
          entries: [0, 1, 2, 3, 4, 5, 6].flatMap((dayOfWeek) => [
            {
              id: newId('tge'), dayOfWeek, startMinute: 0, endMinute: 7 * 60,
              title: 'Sleep', trackerId: 'trk_sleep', kind: 'sleep' as const,
              protected: true, locked: true,
            },
            {
              id: newId('tge'), dayOfWeek, startMinute: 13 * 60, endMinute: 13 * 60 + 45,
              title: 'Lunch', trackerId: 'trk_meals', kind: 'meal' as const,
              protected: true, locked: false,
            },
            {
              id: newId('tge'), dayOfWeek, startMinute: 20 * 60, endMinute: 20 * 60 + 45,
              title: 'Dinner', trackerId: 'trk_meals', kind: 'meal' as const,
              protected: true, locked: false,
            },
            {
              id: newId('tge'), dayOfWeek, startMinute: 23 * 60, endMinute: 24 * 60,
              title: 'Sleep', trackerId: 'trk_sleep', kind: 'sleep' as const,
              protected: true, locked: true,
            },
          ]),
        });
      }
    },
  );
}
