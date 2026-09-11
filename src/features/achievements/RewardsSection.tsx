import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/Progress';
import { ConfirmDialog } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { formatDateKeyShort, toDateKey } from '@/lib/date';
import { REPEAT_MODE_LABELS, describeNextAvailability } from '@/engines/conditionEngine';
import {
  claimEarning, createReward, deleteReward, duplicateReward, evaluateRewards,
  unclaimEarning, updateReward, type RewardInput, type RewardView,
} from '@/services/rewardService';
import type { RewardEarning } from '@/types';
import { RewardEditor } from './RewardEditor';

/**
 * Rewards section: user-defined goals with their own conditions, evaluated
 * against the same measured metrics as the built-in achievements.
 */
export function RewardsSection() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<RewardView | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RewardView | null>(null);

  const result = useLiveQuery(() => evaluateRewards(new Date()), [refreshKey]);
  const refresh = () => setRefreshKey((k) => k + 1);

  const views = result?.views ?? [];
  const metrics = result?.metrics ?? null;
  const earned = views.filter((v) => v.earnings.length > 0).length;

  const history = useMemo(
    () => views
      .flatMap((v) => v.earnings.map((e) => ({ earning: e, view: v })))
      .sort((a, b) => b.earning.at - a.earning.at)
      .slice(0, 12),
    [views],
  );

  const initialFor = (view: RewardView): RewardInput => ({
    name: view.reward.name,
    description: view.reward.description,
    treat: view.reward.treat,
    xpValue: view.reward.xpValue,
    repeat: view.repeat,
    condition: view.condition,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="t-title">Your rewards</h2>
          <p className="t-muted mt-0.5">
            {views.length === 0
              ? 'Define what you want to earn, and what has to be true for you to earn it.'
              : `${earned} of ${views.length} have been earned at least once.`}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New reward
        </Button>
      </div>

      {!result ? (
        <Card><p className="t-muted">Measuring your records…</p></Card>
      ) : views.length === 0 ? (
        <EmptyState
          icon={<Gift className="h-6 w-6" />}
          title="No rewards yet"
          description="Build a condition from the numbers your records already track — study minutes this week, tasks completed, days with nothing overdue — and decide what you get when it holds."
          action={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New reward</Button>}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {views.map((view) => (
            <RewardCard
              key={view.reward.id}
              view={view}
              onEdit={() => setEditing(view)}
              onDuplicate={async () => { await duplicateReward(view.reward.id); refresh(); }}
              onDelete={() => setPendingDelete(view)}
              onClaim={async (id) => { await claimEarning(id); refresh(); }}
              onUnclaim={async (id) => { await unclaimEarning(id); refresh(); }}
            />
          ))}
        </div>
      )}

      {history.length > 0 ? (
        <Card>
          <div className="t-label mb-2">Earned history</div>
          <ul className="divide-y divide-line">
            {history.map(({ earning, view }) => (
              <li key={earning.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0 truncate text-sm text-ink">{view.reward.name}</span>
                <span className="t-meta shrink-0">
                  {formatDateKeyShort(toDateKey(earning.at))}
                  {earning.xpAwarded > 0 ? ` · +${earning.xpAwarded} XP` : ''}
                  {earning.claimedAt ? ' · claimed' : ' · unclaimed'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <RewardEditor
        open={creating}
        onClose={() => setCreating(false)}
        title="New reward"
        metrics={metrics}
        onSubmit={async (input) => { await createReward(input); refresh(); }}
      />

      <RewardEditor
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit reward"
        metrics={metrics}
        initial={editing ? initialFor(editing) : undefined}
        onSubmit={async (input) => {
          if (editing) await updateReward(editing.reward.id, input);
          refresh();
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this reward?"
        danger
        confirmLabel="Delete"
        message={
          <>
            <strong>{pendingDelete?.reward.name}</strong> and its {pendingDelete?.earnings.length ?? 0} earned
            {' '}entries will be removed. This cannot be undone.
          </>
        }
        onConfirm={async () => {
          if (pendingDelete) await deleteReward(pendingDelete.reward.id);
          setPendingDelete(null);
          refresh();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface RewardCardProps {
  view: RewardView;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClaim: (earningId: string) => void;
  onUnclaim: (earningId: string) => void;
}

function RewardCard({ view, onEdit, onDuplicate, onDelete, onClaim, onUnclaim }: RewardCardProps) {
  const { reward, evaluation } = view;
  const met = evaluation.met;
  const lastEarning: RewardEarning | undefined = view.earnings[0];

  return (
    <Card className={cn(!met && 'bg-surface-raised/60')}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
            met ? 'border-accent/25 bg-accent-soft text-accent-ink' : 'border-line bg-surface-sunken text-ink-faint',
          )}
          aria-hidden
        >
          <Gift className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-ink">{reward.name}</span>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton label="Edit reward" size="xs" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></IconButton>
              <IconButton label="Duplicate reward" size="xs" onClick={onDuplicate}><Copy className="h-3.5 w-3.5" /></IconButton>
              <IconButton label="Delete reward" size="xs" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></IconButton>
            </div>
          </div>
          {reward.description ? <p className="t-meta mt-0.5">{reward.description}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={met ? 'positive' : 'outline'}>{met ? 'Met' : 'Not met'}</Badge>
            <Badge tone="neutral">{REPEAT_MODE_LABELS[view.repeat]}</Badge>
            {reward.xpValue > 0 ? <Badge tone="neutral">+{reward.xpValue} XP</Badge> : null}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <ProgressBar value={evaluation.progress} size="sm" color={met ? 'teal' : 'indigo'} />
        <p className="t-meta mt-1.5">
          {met ? evaluation.summary : `Not met — ${lowerFirst(evaluation.summary)}`}
        </p>
      </div>

      {evaluation.leaves.length > 1 ? (
        <ul className="mt-2 space-y-1">
          {evaluation.leaves.map((leafTrace) => (
            <li key={leafTrace.id} className="flex items-baseline gap-2">
              <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', leafTrace.met ? 'bg-positive' : 'bg-line-strong')} aria-hidden />
              <span className="t-meta">{leafTrace.explanation}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {reward.treat ? (
        <p className="mt-3 rounded-md border border-line bg-surface-sunken/60 px-2.5 py-2 text-xs text-ink-muted">
          Treat: {reward.treat}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
        <span className="t-meta">
          {view.earnedThisPeriod
            ? `Earned ${formatDateKeyShort(view.earnedThisPeriod.date)} · ${describeNextAvailability(view.repeat, new Date())}`
            : view.earnings.length > 0
              ? `Earned ${view.earnings.length} time${view.earnings.length === 1 ? '' : 's'}`
              : 'Not earned yet'}
        </span>
        {lastEarning ? (
          lastEarning.claimedAt ? (
            <Button size="xs" variant="ghost" onClick={() => onUnclaim(lastEarning.id)}>Undo claim</Button>
          ) : (
            <Button size="xs" variant="secondary" onClick={() => onClaim(lastEarning.id)}>Mark claimed</Button>
          )
        ) : null}
      </div>
    </Card>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
