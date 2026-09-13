import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { WidgetShell, WidgetEmpty } from './WidgetShell';
import { evaluateAchievements } from '@/services/achievementService';
import { ProgressBar } from '@/components/ui/Progress';
import type { WidgetComponentProps } from './types';

/** The one or two locked achievements nearest to their unlock threshold. */
export function AchievementProgressWidget(_props: WidgetComponentProps) {
  const evaluation = useLiveQuery(() => evaluateAchievements(), []);
  const nearest = (evaluation?.views ?? [])
    .filter((v) => !v.unlocked)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 2);

  return (
    <WidgetShell title="Achievement Progress">
      {evaluation === undefined ? (
        <p className="t-meta py-2">Loading…</p>
      ) : nearest.length === 0 ? (
        <WidgetEmpty text="Every achievement is unlocked." />
      ) : (
        <div className="space-y-3">
          {nearest.map((view) => (
            <Link key={view.definition.key} to="/achievements" className="block hover:opacity-90">
              <div className="flex items-center gap-1.5 text-sm text-ink">
                <Trophy className="h-3.5 w-3.5 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate">{view.definition.title}</span>
              </div>
              <ProgressBar className="mt-1.5" value={view.progress} size="sm" />
              <div className="t-meta mt-1">{view.progressLabel}</div>
            </Link>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
