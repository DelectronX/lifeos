import { WidgetShell } from './WidgetShell';
import { useLiveProfile } from '@/state/useLiveData';
import { Stat } from '@/components/ui/Progress';
import type { WidgetComponentProps } from './types';

/** Current consecutive-active-day streak, read from the cached profile. */
export function StudyStreakWidget(_props: WidgetComponentProps) {
  const profile = useLiveProfile();
  const streak = profile?.currentStreak ?? 0;

  return (
    <WidgetShell title="Study Streak">
      <Stat
        label="Current streak"
        value={`${streak} day${streak === 1 ? '' : 's'}`}
        sub={streak === 0 ? 'No active streak yet.' : `Best ${profile?.longestStreak ?? 0}`}
      />
    </WidgetShell>
  );
}
