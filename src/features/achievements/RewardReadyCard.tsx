import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Gift } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { currencyBalance } from '@/services/currencyService';
import { listRedeemable } from '@/services/rewardService';

/**
 * Home nudge: shown only when the reward-currency balance covers at least
 * one redeemable reward. Lists what can be redeemed right now.
 */
export function RewardReadyCard() {
  const data = useLiveQuery(async () => {
    const [balance, items] = await Promise.all([currencyBalance(), listRedeemable()]);
    return { balance, affordable: items.filter((r) => (r.cost ?? 0) <= balance) };
  }, []);
  if (!data || data.affordable.length === 0) return null;
  const top = [...data.affordable].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)).slice(0, 3);
  return (
    <Card className="flex items-center gap-3 px-3.5 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Gift className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">You've earned a reward</div>
        <div className="t-meta truncate">
          {data.balance} available · {top.map((r) => r.name).join(', ')}
          {data.affordable.length > top.length ? ` +${data.affordable.length - top.length} more` : ''}
        </div>
      </div>
      <Link to="/achievements?section=rewards" className="shrink-0 text-sm font-medium text-accent hover:underline">
        Redeem
      </Link>
    </Card>
  );
}
