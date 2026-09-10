import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarPlus, RotateCcw } from 'lucide-react';
import { Page, PageSection } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Stat } from '@/components/ui/Progress';
import { db } from '@/db/db';
import { todayKey } from '@/lib/date';
import { useRevisionEntries, useRevisionPlans, useSchedulingConfig, useTrackers } from '@/state/useLiveData';
import { toast } from '@/state/toastStore';
import {
  buildDashboard, completeRevision, createTaskForRevision, postponeRevision,
  recomputeAllMissedRevisions, uncompleteRevision,
  type RevisionCard, type RevisionDashboard,
} from '@/services/revisionService';
import { RevisionEntryRow } from './RevisionEntryRow';
import { RevisionCompleteDialog } from './RevisionCompleteDialog';
import { RevisionPlanDialog } from './RevisionPlanDialog';
import { RescheduleRevisionDialog } from './RescheduleRevisionDialog';

/**
 * Revision dashboard — Overdue / Due today / Tomorrow / Upcoming / Missed /
 * Recently completed, exactly as the engine buckets them. Every action here
 * writes through revisionService, which is the only path to the DB.
 */
export function RevisionPage() {
  const plans = useRevisionPlans();
  const entries = useRevisionEntries();
  const trackers = useTrackers(true);
  const config = useSchedulingConfig();
  const today = todayKey();

  const [completing, setCompleting] = useState<RevisionCard | null>(null);
  const [rescheduling, setRescheduling] = useState<RevisionCard | null>(null);
  const [creating, setCreating] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  const dashboard: RevisionDashboard = useMemo(
    () => buildDashboard(plans, entries, trackers, config, today),
    [plans, entries, trackers, config, today],
  );

  const handlePostpone = async (card: RevisionCard, days: number) => {
    const result = await postponeRevision(card.entry.id, days);
    if (result) toast.success('Revision postponed', result.explanation);
  };

  const handleComplete = async (card: RevisionCard, quality: number) => {
    const result = await completeRevision(card.entry.id, quality);
    setCompleting(null);
    if (!result) return;
    toast.success(
      result.lapsed ? 'Marked for earlier review' : 'Revision complete',
      `${result.explanation}${result.xpAwarded > 0 ? ` +${result.xpAwarded} XP.` : ''}`,
    );
  };

  const handleUndo = async (card: RevisionCard) => {
    await uncompleteRevision(card.entry.id);
    toast.show('Revision reopened', 'The completion and its XP were removed.');
  };

  const handleSchedule = async (card: RevisionCard) => {
    const taskId = await createTaskForRevision(card.entry.id);
    if (taskId) toast.success('Task created', `"Revise: ${card.plan.title}" is now on your task list for ${card.entry.dueDate}.`);
    else toast.warning('Already scheduled', 'This revision already has a task.');
  };

  const handleSweep = async () => {
    setSweeping(true);
    try {
      const result = await recomputeAllMissedRevisions(today);
      if (result.plansTouched === 0) {
        toast.show('Nothing overdue', 'Every revision ladder is on track.');
      } else {
        toast.withAction(
          `${result.entriesMoved} revision${result.entriesMoved === 1 ? '' : 's'} re-spaced`,
          result.explanations[0],
          undefined,
        );
      }
    } finally {
      setSweeping(false);
    }
  };

  const rowProps = {
    onComplete: setCompleting,
    onPostpone: handlePostpone,
    onReschedule: setRescheduling,
    onSchedule: handleSchedule,
    onUndo: handleUndo,
  };

  const totalPending =
    dashboard.overdue.length + dashboard.dueToday.length + dashboard.tomorrow.length + dashboard.upcoming.length;

  return (
    <Page
      title="Revision"
      subtitle="Spaced repetition, scheduled from the day you learnt the material and re-anchored on real life when you fall behind."
      actions={
        <>
          <Button size="sm" variant="ghost" loading={sweeping} iconLeft={<RotateCcw className="h-4 w-4" />} onClick={handleSweep}>
            Recompute missed
          </Button>
          <Button size="sm" variant="primary" iconLeft={<CalendarPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Schedule revisions
          </Button>
        </>
      }
    >
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><Stat label="Due today" value={dashboard.dueToday.length} sub={`${dashboard.tomorrow.length} tomorrow`} /></Card>
        <Card>
          <Stat
            label="Overdue"
            value={dashboard.overdue.length}
            tone={dashboard.overdue.length > 0 ? 'critical' : 'default'}
            sub={dashboard.missed.length ? `${dashboard.missed.length} past the grace period` : 'None past due'}
          />
        </Card>
        <Card><Stat label="Active plans" value={dashboard.totalActivePlans} sub={`${totalPending} repetitions ahead`} /></Card>
        <Card>
          <Stat
            label="Completion rate"
            value={`${Math.round(dashboard.completionRate * 100)}%`}
            sub="Completed vs missed, all time"
          />
        </Card>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<RotateCcw className="h-6 w-6" />}
          title="No revisions scheduled"
          description="Finish a learning unit, then schedule its revision ladder. The default is 1, 3, 7, 14, 30, 60 and 120 days after the day you learnt it."
          action={<Button variant="primary" onClick={() => setCreating(true)}>Schedule revisions</Button>}
        />
      ) : (
        <>
          <Section title="Overdue" description="Past their due date but still inside the grace period." cards={dashboard.overdue} tone="critical" {...rowProps} />
          <Section title="Missed" description="More than the configured grace period late — recompute to re-space the ladder." cards={dashboard.missed} tone="caution" {...rowProps} />
          <Section title="Due today" cards={dashboard.dueToday} tone="accent" {...rowProps} />
          <Section title="Due tomorrow" cards={dashboard.tomorrow} {...rowProps} />
          <Section title="Upcoming" description="The rest of the ladder." cards={dashboard.upcoming} collapsedAfter={8} {...rowProps} />
          <Section title="Recently completed" description="Last 14 days." cards={dashboard.recentlyCompleted} completed {...rowProps} />
        </>
      )}

      {completing ? (
        <RevisionCompleteDialog
          card={completing}
          onClose={() => setCompleting(null)}
          onConfirm={(quality) => handleComplete(completing, quality)}
        />
      ) : null}

      {rescheduling ? (
        <RescheduleRevisionDialog card={rescheduling} onClose={() => setRescheduling(null)} />
      ) : null}

      {creating ? <RevisionPlanDialog onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}

function Section({
  title, description, cards, tone, completed, collapsedAfter,
  onComplete, onPostpone, onReschedule, onSchedule, onUndo,
}: {
  title: string;
  description?: string;
  cards: RevisionCard[];
  tone?: 'critical' | 'caution' | 'accent';
  completed?: boolean;
  collapsedAfter?: number;
  onComplete: (c: RevisionCard) => void;
  onPostpone: (c: RevisionCard, days: number) => void | Promise<void>;
  onReschedule: (c: RevisionCard) => void;
  onSchedule: (c: RevisionCard) => void | Promise<void>;
  onUndo: (c: RevisionCard) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (cards.length === 0) return null;

  const limit = collapsedAfter && !expanded ? collapsedAfter : cards.length;
  const shown = cards.slice(0, limit);
  const hidden = cards.length - shown.length;

  return (
    <PageSection
      title={
        <span className="flex items-center gap-2">
          {title}
          <Badge tone={tone ?? 'neutral'}>{cards.length}</Badge>
        </span>
      }
      description={description}
    >
      <div className="space-y-2">
        {shown.map((card) => (
          <RevisionEntryRow
            key={card.entry.id}
            card={card}
            completed={completed}
            onComplete={() => onComplete(card)}
            onPostpone={(days) => onPostpone(card, days)}
            onReschedule={() => onReschedule(card)}
            onSchedule={() => onSchedule(card)}
            onUndo={() => onUndo(card)}
          />
        ))}
      </div>
      {hidden > 0 ? (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setExpanded(true)}>
          Show {hidden} more
        </Button>
      ) : null}
    </PageSection>
  );
}

/** Small helper used by the plan dialog: count of plans per tracker. */
export function useRevisionPlanCounts(): Record<string, number> {
  return (
    useLiveQuery(async () => {
      const plans = await db.revisionPlans.toArray();
      const out: Record<string, number> = {};
      for (const p of plans) out[p.trackerId] = (out[p.trackerId] ?? 0) + 1;
      return out;
    }, []) ?? {}
  );
}
