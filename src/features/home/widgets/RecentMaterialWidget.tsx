import { useNavigate } from 'react-router-dom';
import { FileText, Link2 } from 'lucide-react';
import { WidgetShell, WidgetEmpty } from './WidgetShell';
import { useResources } from '@/state/useLiveData';
import type { WidgetComponentProps } from './types';

/** The most recently added/updated resources (files and links). */
export function RecentMaterialWidget(_props: WidgetComponentProps) {
  const navigate = useNavigate();
  const resources = useResources();
  const recent = resources.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <WidgetShell title="Recent Study Material">
      {recent.length === 0 ? (
        <WidgetEmpty text="No materials added yet." />
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {recent.slice(0, 6).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => navigate(`/practice/resource/${r.id}`)}
                className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm text-ink hover:bg-surface-sunken"
              >
                {r.attachmentId ? (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                ) : (
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                )}
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}
