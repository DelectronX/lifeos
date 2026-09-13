import { Link } from 'react-router-dom';
import { WidgetShell } from './WidgetShell';
import { useLiveProfile, useSchedulingConfig } from '@/state/useLiveData';
import { levelProgress } from '@/engines/xp';
import { ProgressBar, Ring } from '@/components/ui/Progress';
import type { WidgetComponentProps } from './types';

/** Current level + progress toward the next, tapping through to Achievements. */
export function XPProgressWidget(_props: WidgetComponentProps) {
  const profile = useLiveProfile();
  const config = useSchedulingConfig();
  const level = profile ? levelProgress(profile.totalXP, config.xp) : null;

  return (
    <WidgetShell title="EP / XP Progress">
      <Link to="/achievements" className="flex items-center gap-3 hover:opacity-90">
        <Ring value={level?.progress ?? 0} size={48} stroke={5}>
          <span className="t-num text-xs font-semibold text-ink">{level?.level ?? 1}</span>
        </Ring>
        <div className="min-w-0">
          <div className="t-num text-sm text-ink">{(profile?.totalXP ?? 0).toLocaleString()} XP</div>
          <div className="t-meta mt-0.5">
            {Math.round(level?.into ?? 0)} / {Math.round(level?.span ?? 0)} to level {(level?.level ?? 1) + 1}
          </div>
        </div>
      </Link>
      <ProgressBar className="mt-3" value={level?.progress ?? 0} size="sm" />
    </WidgetShell>
  );
}
