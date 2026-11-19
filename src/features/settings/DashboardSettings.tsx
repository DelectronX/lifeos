import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { useDashboardLayout } from '@/state/useLiveData';
import { setDashboardLayout } from '@/services/settingsService';
import { WIDGET_REGISTRY, RECOMMENDED_LAYOUT } from '@/features/home/widgets/registry';
import {
  addWidget, availableWidgetTypes, cycleWidgetSize, moveWidget, removeWidget, setWidgetHidden,
} from '@/features/home/widgets/layout';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';
import { SettingsSection } from './SettingsSection';

const SIZE_LABEL = { small: 'S', medium: 'M', large: 'L' } as const;

/** Home widgets: visibility, order, size — the same layout Home's Customize mode edits. */
export function DashboardSettings() {
  const layout = useDashboardLayout();
  const available = availableWidgetTypes(layout);
  const save = (next: typeof layout) => void setDashboardLayout(next);

  return (
    <SettingsSection
      title="Home widgets"
      description="Choose what the Home dashboard shows and in what order. Hidden widgets keep their settings. You can also arrange them directly on Home with Customize."
      action={<Button size="sm" variant="ghost" onClick={() => { save(RECOMMENDED_LAYOUT.reduce((l, t) => addWidget(l, t), [] as typeof layout)); toast.success('Home reset to the recommended layout'); }}>Reset</Button>}
    >
      <ol className="divide-y divide-line-faint overflow-hidden rounded-[var(--r-lg)] bg-ink/[0.03]">
        {layout.map((w, i) => {
          const def = WIDGET_REGISTRY[w.type];
          if (!def) return null;
          return (
            <li key={w.id} className={cn('flex items-center gap-2 px-3 py-2', w.hidden && 'opacity-55')}>
              <span className="t-num w-5 shrink-0 text-[0.75rem] text-ink-faint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.875rem] text-ink">{def.label}</div>
                <div className="truncate text-[0.75rem] text-ink-faint">{def.description}</div>
              </div>
              <button type="button" onClick={() => save(cycleWidgetSize(layout, w.id))} aria-label={`Size of ${def.label}: ${w.size}. Change`} title="Size"
                className="t-num grid h-7 w-7 place-items-center rounded-[7px] bg-ink/[0.07] text-[0.6875rem] font-semibold text-ink-muted hover:text-ink">{SIZE_LABEL[w.size]}</button>
              <IconButton size="sm" variant="ghost" label={`Move ${def.label} up`} disabled={i === 0} onClick={() => save(moveWidget(layout, w.id, -1))}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
              <IconButton size="sm" variant="ghost" label={`Move ${def.label} down`} disabled={i === layout.length - 1} onClick={() => save(moveWidget(layout, w.id, 1))}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
              <IconButton size="sm" variant="ghost" label={w.hidden ? `Show ${def.label}` : `Hide ${def.label}`} onClick={() => save(setWidgetHidden(layout, w.id, !w.hidden))}>
                {w.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </IconButton>
              <IconButton size="sm" variant="ghost" label={`Remove ${def.label}`} onClick={() => save(removeWidget(layout, w.id))}><X className="h-3.5 w-3.5" /></IconButton>
            </li>
          );
        })}
      </ol>
      {available.length ? (
        <div className="flex flex-wrap gap-1.5">
          {available.map((t) => (
            <Button key={t} size="sm" variant="secondary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => save(addWidget(layout, t))}>
              {WIDGET_REGISTRY[t].label}
            </Button>
          ))}
        </div>
      ) : null}
    </SettingsSection>
  );
}
