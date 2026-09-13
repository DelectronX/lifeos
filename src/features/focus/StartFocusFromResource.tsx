import { useEffect, useState } from 'react';
import { Lock, Play } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Input';
import { useTimerStore } from '@/state/useTimer';
import { useFocusLockStore } from '@/state/focusLockStore';
import { hasFocusPassword } from '@/services/focusLockService';
import { toast } from '@/state/toastStore';
import type { ID } from '@/types';

const DEFAULT_MINUTES = 25;

/**
 * Focus entry point launched from inside the file viewer. Starts a REAL
 * session through the same timer engine every other Focus surface uses
 * (`useTimerStore.start` -> `timerService.startTimer`), seeded with the
 * resource's id (and its tracker, standing in for "subject") instead of a
 * task. Optionally engages the in-app locked focus mode — see
 * `LockedFocusOverlay` for exactly what that does and does not restrict.
 */
export function StartFocusFromResource({
  open, onClose, resourceId, resourceTitle, trackerId,
}: {
  open: boolean;
  onClose: () => void;
  resourceId: ID;
  resourceTitle: string;
  trackerId: ID;
}) {
  const start = useTimerStore((s) => s.start);
  const lock = useFocusLockStore((s) => s.lock);
  const [minutes, setMinutes] = useState(String(DEFAULT_MINUTES));
  const [lockSession, setLockSession] = useState(false);
  const [passwordAvailable, setPasswordAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLockSession(false);
    void hasFocusPassword().then(setPasswordAvailable);
  }, [open]);

  const onStart = async () => {
    setBusy(true);
    try {
      await start({
        mode: 'focus',
        trackerId,
        resourceId,
        targetMinutes: Math.max(1, Math.round(Number(minutes) || DEFAULT_MINUTES)),
        label: resourceTitle,
      });
      if (lockSession && passwordAvailable) {
        const sessionId = useTimerStore.getState().snapshot?.id;
        if (sessionId) lock(sessionId);
      }
      toast.success('Focus session started', resourceTitle);
      onClose();
    } catch (e) {
      toast.error('Could not start focus session', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Start focus session" description={resourceTitle} size="sm">
      <div className="space-y-4">
        <Field label="Target minutes">
          <Input
            type="number"
            min={1}
            max={600}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </Field>

        {passwordAvailable ? (
          <Toggle
            checked={lockSession}
            onChange={setLockSession}
            label="Lock this session"
            description="Hides the app's navigation until you finish or enter your Focus password to exit early. In-app only — see the lock screen for exactly what that means."
          />
        ) : (
          <p className="t-meta">
            Set a Focus password in Settings to unlock the option to lock this session.
          </p>
        )}

        <Button
          variant="primary"
          className="w-full"
          iconLeft={lockSession ? <Lock className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          loading={busy}
          onClick={() => void onStart()}
        >
          Start focus
        </Button>
      </div>
    </Modal>
  );
}
