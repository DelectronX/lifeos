import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Coins, Undo2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { toast } from '@/state/toastStore';
import { formatDateKeyShort } from '@/lib/date';
import { db } from '@/db/db';
import { currencyBalance, recentCurrency } from '@/services/currencyService';
import { listRedeemable, redeemReward, undoRedemption } from '@/services/rewardService';
import type { CustomReward } from '@/types';

/**
 * Reward shop — redeemable rewards bought with reward currency (separate from
 * XP). The catalogue is plain data (CustomReward rows with kind 'redeemable');
 * nothing here is redeemed unless the user presses Redeem and confirms.
 */
export function RewardShopSection() {
  const [pending, setPending] = useState<CustomReward | null>(null);
  const data = useLiveQuery(async () => {
    const [balance, items, ledger, earnings] = await Promise.all([
      currencyBalance(), listRedeemable(), recentCurrency(15), db.rewardEarnings.toArray(),
    ]);
    return { balance, items, ledger, redemptions: earnings.filter((e) => e.currencySpent).sort((a, b) => b.at - a.at).slice(0, 10) };
  }, []);

  if (!data || (data.items.length === 0 && data.ledger.length === 0)) return null;
  const { balance, items, ledger, redemptions } = data;
  const names = new Map(items.map((r) => [r.id, r.name]));

  const confirm = async () => {
    if (!pending) return;
    const reward = pending;
    setPending(null);
    const outcome = await redeemReward(reward.id);
    if (!outcome.ok) { toast.warning('Not redeemed', outcome.message); return; }
    toast.withAction(`Redeemed: ${reward.name}`, outcome.message, {
      label: 'Undo',
      onClick: async () => {
        if (outcome.earning) await undoRedemption(outcome.earning.id);
        toast.success('Redemption undone', 'The cost was refunded.');
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="t-title">Reward shop</h2>
          <p className="t-muted mt-0.5">Spend reward currency earned from real, completed work. XP and level are not affected.</p>
        </div>
        <Badge tone="accent"><Coins className="mr-1 h-3.5 w-3.5" />{balance} available</Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((r) => {
          const cost = r.cost ?? 0;
          const short = balance < cost;
          return (
            <Card key={r.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{r.name}</div>
                {r.description ? <div className="t-meta truncate">{r.description}</div> : null}
                <div className="t-num mt-0.5 text-xs text-ink-muted">{cost}</div>
              </div>
              <Button size="sm" disabled={short} title={short ? `Needs ${cost - balance} more` : undefined} onClick={() => setPending(r)}>
                Redeem
              </Button>
            </Card>
          );
        })}
      </div>

      {ledger.length > 0 || redemptions.length > 0 ? (
        <Card className="p-3">
          <h3 className="t-label mb-2">History</h3>
          <ul className="space-y-1">
            {redemptions.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">Redeemed {names.get(e.rewardId) ?? 'reward'} · {formatDateKeyShort(e.date)}</span>
                <span className="flex items-center gap-2">
                  <span className="t-num text-ink-muted">−{e.currencySpent}</span>
                  <IconButton size="sm" label="Undo redemption" onClick={() => void undoRedemption(e.id)}><Undo2 className="h-3.5 w-3.5" /></IconButton>
                </span>
              </li>
            ))}
            {ledger.filter((t) => t.amount > 0).slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-sm text-ink-muted">
                <span className="truncate">{t.description} · {formatDateKeyShort(t.date)}</span>
                <span className="t-num">+{t.amount}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => void confirm()}
        title={`Redeem ${pending?.name ?? ''}?`}
        message={`This spends ${pending?.cost ?? 0} of your ${balance} reward currency.`}
        confirmLabel="Redeem"
      />
    </div>
  );
}
