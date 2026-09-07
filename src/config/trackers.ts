import type { Pillar, TrackerColor } from '@/types';

export interface TrackerSeed {
  id: string;
  name: string;
  pillar: Pillar;
  parentId: string | null;
  color: TrackerColor;
  system: boolean;
  defaultProtected: boolean;
  weeklyTargetMinutes?: number;
}

/**
 * The four pillars are ordinary root trackers; subjects are children.
 * System trackers model real-world protected time and cannot be deleted.
 */
export const DEFAULT_TRACKERS: TrackerSeed[] = [
  { id: 'trk_study', name: 'Study', pillar: 'study', parentId: null, color: 'indigo', system: true, defaultProtected: false, weeklyTargetMinutes: 900 },
  { id: 'trk_fitness', name: 'Fitness', pillar: 'fitness', parentId: null, color: 'teal', system: true, defaultProtected: false, weeklyTargetMinutes: 240 },
  { id: 'trk_skills', name: 'Skills', pillar: 'skills', parentId: null, color: 'violet', system: true, defaultProtected: false, weeklyTargetMinutes: 300 },
  { id: 'trk_personal', name: 'Personal', pillar: 'personal', parentId: null, color: 'amber', system: true, defaultProtected: false, weeklyTargetMinutes: 180 },

  { id: 'trk_sleep', name: 'Sleep', pillar: 'system', parentId: null, color: 'slate', system: true, defaultProtected: true },
  { id: 'trk_school', name: 'School', pillar: 'system', parentId: null, color: 'sky', system: true, defaultProtected: true },
  { id: 'trk_meals', name: 'Meals', pillar: 'system', parentId: null, color: 'stone', system: true, defaultProtected: true },
  { id: 'trk_break', name: 'Break', pillar: 'system', parentId: null, color: 'lime', system: true, defaultProtected: false },
  { id: 'trk_free', name: 'Free', pillar: 'system', parentId: null, color: 'stone', system: true, defaultProtected: false },
];

/** Restrained palette: low-chroma fills, readable text, subtle borders. */
export const TRACKER_PALETTE: Record<TrackerColor, {
  dot: string; chip: string; block: string; bar: string; hex: string;
}> = {
  indigo: { dot: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/25', block: 'bg-indigo-50/90 border-indigo-300 text-indigo-950 dark:bg-indigo-500/15 dark:border-indigo-400/40 dark:text-indigo-50', bar: 'bg-indigo-500', hex: '#6366f1' },
  teal: { dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/25', block: 'bg-teal-50/90 border-teal-300 text-teal-950 dark:bg-teal-500/15 dark:border-teal-400/40 dark:text-teal-50', bar: 'bg-teal-500', hex: '#14b8a6' },
  amber: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25', block: 'bg-amber-50/90 border-amber-300 text-amber-950 dark:bg-amber-500/15 dark:border-amber-400/40 dark:text-amber-50', bar: 'bg-amber-500', hex: '#f59e0b' },
  rose: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25', block: 'bg-rose-50/90 border-rose-300 text-rose-950 dark:bg-rose-500/15 dark:border-rose-400/40 dark:text-rose-50', bar: 'bg-rose-500', hex: '#f43f5e' },
  violet: { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/25', block: 'bg-violet-50/90 border-violet-300 text-violet-950 dark:bg-violet-500/15 dark:border-violet-400/40 dark:text-violet-50', bar: 'bg-violet-500', hex: '#8b5cf6' },
  slate: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/25', block: 'bg-slate-100/90 border-slate-300 text-slate-900 dark:bg-slate-500/15 dark:border-slate-400/30 dark:text-slate-100', bar: 'bg-slate-400', hex: '#94a3b8' },
  sky: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/25', block: 'bg-sky-50/90 border-sky-300 text-sky-950 dark:bg-sky-500/15 dark:border-sky-400/40 dark:text-sky-50', bar: 'bg-sky-500', hex: '#0ea5e9' },
  lime: { dot: 'bg-lime-500', chip: 'bg-lime-50 text-lime-700 border-lime-200 dark:bg-lime-500/10 dark:text-lime-300 dark:border-lime-500/25', block: 'bg-lime-50/90 border-lime-300 text-lime-950 dark:bg-lime-500/15 dark:border-lime-400/40 dark:text-lime-50', bar: 'bg-lime-500', hex: '#84cc16' },
  stone: { dot: 'bg-stone-400', chip: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-500/10 dark:text-stone-300 dark:border-stone-500/25', block: 'bg-stone-100/90 border-stone-300 text-stone-900 dark:bg-stone-500/15 dark:border-stone-400/30 dark:text-stone-100', bar: 'bg-stone-400', hex: '#a8a29e' },
};

export const TRACKER_COLORS: TrackerColor[] = ['indigo', 'teal', 'amber', 'rose', 'violet', 'sky', 'lime', 'slate', 'stone'];

export const PILLAR_LABELS: Record<Pillar, string> = {
  study: 'Study',
  fitness: 'Fitness',
  skills: 'Skills',
  personal: 'Personal',
  system: 'System',
};
