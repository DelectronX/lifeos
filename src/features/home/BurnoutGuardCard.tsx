import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Feather } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { useLiveSettings, useNow } from '@/state/useLiveData';
import { assessLoad, makeLightDay } from '@/services/burnoutService';
import { todayKey } from '@/lib/date';

/** Home suggestion shown only after a run of hard days; never acts on its own. */
export function BurnoutGuardCard() {
  const today = todayKey();
  const now = useNow(300_000);
  const settings = useLiveSettings();
  const [dismissed, setDismissed] = useState(false);
  const load = useLiveQuery(() => assessLoad(today, now, settings?.weekStartsOn ?? 1), [today, now, settings?.weekStartsOn]);
  if (!load || dismissed || !load.struggling || load.lightDayToday || !load.lightDayAvailable) return null;
  const total = load.missedByDay.reduce((s, d) => s + d.missed, 0);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card px-3.5 py-3 surface-card">
      <Feather className="h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">The last two days were heavy — {total} planned blocks didn&apos;t happen.</div>
        <div className="t-meta">Take a light day? Today&apos;s remaining blocks become optional (school and protected blocks stay). Once a week.</div>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>I&apos;m fine</Button>
        <Button
          size="sm"
          variant="primary"
          onClick={async () => {
            const n = await makeLightDay(today);
            toast.success('Light day', n ? `${n} block${n === 1 ? ' is' : 's are'} optional today. Rest counts too.` : 'Nothing left to lighten today.');
          }}
        >
          Make today light
        </Button>
      </div>
    </div>
  );
}
