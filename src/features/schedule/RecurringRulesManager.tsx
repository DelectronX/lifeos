import { useState } from 'react';
import { Repeat, Trash2 } from 'lucide-react';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import { useRecurringRules, useTrackerMap } from '@/state/useLiveData';
import {
  deleteRecurringRule, describeRule, materialiseRule, updateRecurringRule,
} from '@/services/recurrenceService';
import { addDaysToKey, formatDuration, formatMinute, todayKey } from '@/lib/date';
import type { RecurringRule } from '@/types';

/**
 * Manage recurring series: pause/resume, extend the materialised horizon,
 * inspect exceptions, and delete a whole series.
 * Per-occurrence edits live in the block inspector where the user sees the block.
 */
export function RecurringRulesManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules = useRecurringRules();
  const trackerMap = useTrackerMap();
  const [deleting, setDeleting] = useState<RecurringRule | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title="Recurring blocks"
        description="Series definitions. Editing a single occurrence is done from that block on the calendar."
        footer={<Button variant="ghost" onClick={onClose}>Done</Button>}
      >
        {rules.length === 0 ? (
          <EmptyState
            icon={<Repeat className="h-8 w-8" />}
            title="No recurring blocks yet"
            description="Create one by adding a block and turning on 'Repeat'."
          />
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => {
              const tpl = rule.blockTemplate;
              const tracker = tpl ? trackerMap[tpl.trackerId] : undefined;
              return (
                <div key={rule.id} className="rounded-lg border border-line px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{rule.title}</span>
                        {!rule.active ? <Badge tone="caution">Paused</Badge> : null}
                        {tracker ? <Badge tone="outline">{tracker.name}</Badge> : null}
                      </div>
                      <div className="t-meta mt-0.5">{describeRule(rule)}</div>
                      {tpl ? (
                        <div className="t-meta t-num mt-0.5">
                          {formatMinute(tpl.startMinute)} · {formatDuration(tpl.durationMinutes)}
                          {tpl.protected ? ' · protected' : ''}
                        </div>
                      ) : null}
                      {rule.lastGeneratedDate ? (
                        <div className="t-meta mt-0.5">Materialised through {rule.lastGeneratedDate}.</div>
                      ) : null}
                    </div>
                    <IconButton label="Delete series" size="sm" variant="danger" onClick={() => setDeleting(rule)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Toggle
                      checked={rule.active}
                      onChange={async (v) => {
                        await updateRecurringRule(rule.id, { active: v });
                        toast.success(v ? 'Series resumed' : 'Series paused');
                      }}
                      label={<span className="text-xs">Active</span>}
                    />
                    <Button
                      size="xs"
                      loading={busy === rule.id}
                      onClick={async () => {
                        setBusy(rule.id);
                        try {
                          const from = todayKey();
                          const res = await materialiseRule(rule, from, addDaysToKey(from, 180));
                          toast.success(
                            'Occurrences generated',
                            `${res.blocksCreated + res.tasksCreated} new, ${res.skipped} already existed.`,
                          );
                        } finally { setBusy(null); }
                      }}
                    >
                      Generate next 6 months
                    </Button>
                    {rule.exceptions?.length ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={async () => {
                          await updateRecurringRule(rule.id, { exceptions: [] });
                          toast.success('Exceptions cleared', 'Removed occurrences can be regenerated.');
                        }}
                      >
                        Clear {rule.exceptions.length} exception{rule.exceptions.length === 1 ? '' : 's'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        confirmLabel="Delete series"
        title="Delete this recurring series?"
        message={`"${deleting?.title}" and its upcoming unstarted occurrences will be removed. Past completed occurrences stay in your history.`}
        onConfirm={async () => {
          if (!deleting) return;
          const removed = await deleteRecurringRule(deleting.id, true);
          toast.success('Series deleted', `${removed} upcoming occurrence${removed === 1 ? '' : 's'} removed.`);
          setDeleting(null);
        }}
      />
    </>
  );
}
