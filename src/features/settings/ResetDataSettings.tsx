import { useEffect, useState } from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/state/toastStore';
import { SettingsSection } from './SettingsSection';
import { clearAllData, isFreshInstall } from '@/services/dataResetService';

/**
 * "Start over" — wipes every record and leaves a pristine empty install.
 * There is no sample dataset in this build: LifeOS only ever holds what the
 * user put in it (or imported as their own configuration).
 */
export function ResetDataSettings() {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<boolean | null>(null);

  useEffect(() => { void isFreshInstall().then(setFresh); }, [busy]);

  const run = async () => {
    setPending(false);
    setBusy(true);
    try {
      await clearAllData();
      toast.success('All data cleared', 'You are back to an empty install.');
    } catch (e) {
      toast.error('Could not clear data', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsSection
        title="Reset"
        description="Delete every task, block, goal, session, paper, revision entry, habit, activity, XP and reward record. Preferences are kept."
        action={fresh ? <Badge tone="neutral">Empty install</Badge> : null}
      >
        <div className="flex items-start gap-2 rounded-md border border-caution/30 bg-caution/5 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
          <p className="text-sm text-ink-muted">
            This cannot be undone. Export a JSON backup from “Your data” above first if you are unsure.
          </p>
        </div>
        <div>
          <Button
            variant="danger"
            iconLeft={<Trash2 className="h-4 w-4" />}
            onClick={() => setPending(true)}
            loading={busy}
            disabled={busy || fresh === true}
          >
            Clear all data
          </Button>
        </div>
      </SettingsSection>

      <Modal
        open={pending}
        onClose={() => setPending(false)}
        size="sm"
        title="Clear all data?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void run()}>Clear everything</Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Every record in this browser's LifeOS storage will be deleted and the app returns to an
          empty install. Your theme, working hours and scheduling preferences stay.
        </p>
      </Modal>
    </>
  );
}
