import { useLiveQuery } from 'dexie-react-hooks';
import { todayKey } from '@/lib/date';
import { getDayProgress, type DayProgress } from '@/services/dashboardService';

export type TodayProgress = Omit<DayProgress, 'date'>;

const EMPTY: TodayProgress = { blocks: { done: 0, total: 0 }, tasks: { done: 0, total: 0 }, checklists: { done: 0, total: 0 }, overall: null };

/** Live view of today's completion — see `getDayProgress` (shared with the agent API). */
export function useTodayProgress(): TodayProgress {
  const today = todayKey();
  return useLiveQuery(() => getDayProgress(today), [today]) ?? EMPTY;
}
