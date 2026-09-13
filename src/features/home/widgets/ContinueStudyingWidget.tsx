import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Play } from 'lucide-react';
import { WidgetShell, WidgetEmpty } from './WidgetShell';
import { db } from '@/db/db';
import type { WidgetComponentProps } from './types';

/** The single most-recently-opened resource, resuming it where the viewer left off. */
export function ContinueStudyingWidget(_props: WidgetComponentProps) {
  const navigate = useNavigate();
  const latest = useLiveQuery(async () => {
    const progress = await db.viewerProgress.toArray();
    if (progress.length === 0) return null;
    const mostRecent = progress.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const resource = await db.resources.get(mostRecent.resourceId);
    return resource ? { resource, progress: mostRecent } : null;
  }, []);

  return (
    <WidgetShell title="Continue Studying">
      {latest === undefined ? (
        <p className="t-meta py-2">Loading…</p>
      ) : latest === null ? (
        <WidgetEmpty text="Nothing opened yet." />
      ) : (
        <button
          type="button"
          onClick={() => navigate(`/practice/resource/${latest.resource.id}`)}
          className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left hover:bg-surface-sunken"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
            <Play className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{latest.resource.title}</span>
        </button>
      )}
    </WidgetShell>
  );
}
