import { useState } from 'react';
import { CalendarClock, Check, Tag, Trash2, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Select, Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/Modal';
import { toast } from '@/state/toastStore';
import {
  bulkDeleteTasks, bulkEditTags, bulkSetStatus, bulkShiftDueDate, bulkUpdateTasks,
} from '@/services/taskService';
import { STATUS_LABELS } from '@/services/taskQuery';
import type { ID, TaskStatus, Tracker } from '@/types';

const BULK_STATUSES: TaskStatus[] = ['planned', 'in_progress', 'completed', 'skipped', 'cancelled', 'inbox'];

/**
 * Floating bulk action bar. Every action runs through the service layer so
 * status history, activity rows and derived counters stay correct per task.
 */
export function TaskBulkBar({
  ids, trackers, onClear,
}: {
  ids: ID[];
  trackers: Tracker[];
  onClear: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagAdd, setTagAdd] = useState('');
  const [tagRemove, setTagRemove] = useState('');
  const [busy, setBusy] = useState(false);

  if (!ids.length) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="sticky bottom-4 z-30 mx-auto mt-4 flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-card border border-line bg-surface-raised px-3 py-2 shadow-pop">
        <span className="t-num text-sm font-medium text-ink">{ids.length} selected</span>

        <Select
          value=""
          disabled={busy}
          className="w-auto min-w-[9rem]"
          onChange={(e) => {
            const status = e.target.value as TaskStatus;
            if (!status) return;
            e.target.value = '';
            void run(async () => {
              const n = await bulkSetStatus(ids, status);
              toast.success(`${n} task${n === 1 ? '' : 's'} → ${STATUS_LABELS[status].toLowerCase()}`);
              onClear();
            });
          }}
        >
          <option value="">Set status…</option>
          {BULK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>

        <Select
          value=""
          disabled={busy}
          className="w-auto min-w-[9rem]"
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            e.target.value = '';
            void run(async () => {
              await bulkUpdateTasks(ids, { trackerId: id });
              toast.success(`Moved ${ids.length} task${ids.length === 1 ? '' : 's'}`);
              onClear();
            });
          }}
        >
          <option value="">Move to tracker…</option>
          {trackers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>

        <Select
          value=""
          disabled={busy}
          className="w-auto min-w-[8rem]"
          onChange={(e) => {
            const p = Number(e.target.value);
            if (!p) return;
            e.target.value = '';
            void run(async () => {
              await bulkUpdateTasks(ids, { basePriority: p as 1 | 2 | 3 | 4 | 5 });
              toast.success(`Priority set to P${p}`);
            });
          }}
        >
          <option value="">Priority…</option>
          {[5, 4, 3, 2, 1].map((p) => <option key={p} value={p}>P{p}</option>)}
        </Select>

        <Button
          size="sm"
          disabled={busy}
          iconLeft={<CalendarClock className="h-3.5 w-3.5" />}
          onClick={() => void run(async () => {
            const n = await bulkShiftDueDate(ids, 1);
            toast.success(`Pushed ${n} task${n === 1 ? '' : 's'} by 1 day`);
          })}
        >
          +1 day
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void run(async () => {
            const n = await bulkShiftDueDate(ids, 7);
            toast.success(`Pushed ${n} task${n === 1 ? '' : 's'} by a week`);
          })}
        >
          +1 week
        </Button>

        <Button size="sm" disabled={busy} iconLeft={<Tag className="h-3.5 w-3.5" />} onClick={() => setTagOpen(true)}>
          Tags
        </Button>

        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          iconLeft={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </Button>

        <IconButton label="Clear selection" size="sm" className="ml-auto" onClick={onClear}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        confirmLabel={`Delete ${ids.length}`}
        title="Delete selected tasks?"
        message={`This removes ${ids.length} task${ids.length === 1 ? '' : 's'} and any planned blocks. Completed activity history is preserved.`}
        onConfirm={() => void run(async () => {
          await bulkDeleteTasks(ids);
          toast.success(`Deleted ${ids.length} task${ids.length === 1 ? '' : 's'}`);
          onClear();
        })}
      />

      <Modal
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        size="sm"
        title="Edit tags"
        description={`Applies to ${ids.length} selected task${ids.length === 1 ? '' : 's'}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              iconLeft={<Check className="h-3.5 w-3.5" />}
              onClick={() => void run(async () => {
                await bulkEditTags(
                  ids,
                  tagAdd.split(',').map((t) => t.trim()).filter(Boolean),
                  tagRemove.split(',').map((t) => t.trim()).filter(Boolean),
                );
                toast.success('Tags updated');
                setTagAdd(''); setTagRemove(''); setTagOpen(false);
              })}
            >
              Apply
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">Add tags (comma separated)</span>
            <Input value={tagAdd} onChange={(e) => setTagAdd(e.target.value)} placeholder="urgent, revision" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">Remove tags</span>
            <Input value={tagRemove} onChange={(e) => setTagRemove(e.target.value)} placeholder="old-tag" />
          </label>
        </div>
      </Modal>
    </>
  );
}
