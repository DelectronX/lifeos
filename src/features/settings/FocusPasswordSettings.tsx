import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/state/toastStore';
import {
  clearFocusPassword, hasFocusPassword, MIN_FOCUS_PASSWORD_LENGTH, setFocusPassword,
  verifyFocusPassword,
} from '@/services/focusLockService';
import { SettingsSection } from './SettingsSection';

type Mode = 'idle' | 'set' | 'change' | 'remove' | 'reset';

/**
 * Focus Mode password: set / change / remove / reset infrastructure.
 *
 * Only a salted SHA-256 hash is ever persisted (see focusLockService) and it
 * is stored outside the general Settings/export bundle. The actual lock
 * screen that will call `verifyFocusPassword` is a later feature; this panel
 * is purely the password lifecycle.
 */
export function FocusPasswordSettings() {
  const [exists, setExists] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => setExists(await hasFocusPassword());
  useEffect(() => { void refresh(); }, []);

  const reset = () => { setMode('idle'); setCurrent(''); setNext(''); setConfirm(''); };

  const submitSet = async () => {
    if (next !== confirm) { toast.error('Passwords do not match', 'Re-enter both fields.'); return; }
    setBusy(true);
    try {
      const result = await setFocusPassword(next);
      if (!result.ok) { toast.error('Could not set password', result.error); return; }
      toast.success('Focus password set');
      reset();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const submitChange = async () => {
    setBusy(true);
    try {
      const ok = await verifyFocusPassword(current);
      if (!ok) { toast.error('Current password is incorrect'); return; }
      if (next !== confirm) { toast.error('Passwords do not match', 'Re-enter both fields.'); return; }
      const result = await setFocusPassword(next);
      if (!result.ok) { toast.error('Could not set password', result.error); return; }
      toast.success('Focus password changed');
      reset();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const submitRemove = async () => {
    setBusy(true);
    try {
      const ok = await verifyFocusPassword(current);
      if (!ok) { toast.error('Current password is incorrect'); return; }
      await clearFocusPassword();
      toast.success('Focus password removed', 'Focus Mode has no password now.');
      reset();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (next !== confirm) { toast.error('Passwords do not match', 'Re-enter both fields.'); return; }
    setBusy(true);
    try {
      await clearFocusPassword();
      const result = await setFocusPassword(next);
      if (!result.ok) { toast.error('Could not set password', result.error); return; }
      toast.success('Focus password reset', 'The old password no longer works.');
      reset();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Focus password"
      description="A password that will guard exiting a locked Focus Mode session (the lock screen itself is a future feature — this sets up the password only). Only a one-way hash is ever stored, never the password itself, and it is kept out of your data export."
      action={
        exists === null ? null : (
          <Badge tone={exists ? 'positive' : 'neutral'}>
            {exists ? <ShieldCheck className="mr-1 h-3 w-3" /> : <ShieldOff className="mr-1 h-3 w-3" />}
            {exists ? 'Set' : 'Not set'}
          </Badge>
        )
      }
    >
      {mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          {!exists ? (
            <Button iconLeft={<KeyRound className="h-4 w-4" />} onClick={() => setMode('set')}>
              Set Focus password
            </Button>
          ) : (
            <>
              <Button iconLeft={<KeyRound className="h-4 w-4" />} onClick={() => setMode('change')}>
                Change password
              </Button>
              <Button onClick={() => setMode('remove')}>Remove password</Button>
              <Button variant="danger" onClick={() => setMode('reset')}>Reset password</Button>
            </>
          )}
        </div>
      ) : null}

      {mode === 'set' || mode === 'change' ? (
        <div className="space-y-2 rounded-md border border-line bg-surface px-3 py-3">
          {mode === 'change' ? (
            <Input
              type="password"
              placeholder="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          ) : null}
          <Input
            type="password"
            placeholder={`New password (min ${MIN_FOCUS_PASSWORD_LENGTH} characters)`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void (mode === 'set' ? submitSet() : submitChange())}
            >
              Save
            </Button>
            <Button onClick={reset}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {mode === 'remove' ? (
        <div className="space-y-2 rounded-md border border-line bg-surface px-3 py-3">
          <p className="t-meta">Enter the current password to remove it.</p>
          <Input
            type="password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="danger" loading={busy} onClick={() => void submitRemove()}>
              Remove
            </Button>
            <Button onClick={reset}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {mode === 'reset' ? (
        <div className="space-y-2 rounded-md border border-caution/30 bg-caution/5 px-3 py-3">
          <p className="text-sm text-caution">
            Because the password is one-way hashed, it cannot be recovered — resetting immediately
            replaces it. If you remember the old password, use "Change password" instead.
          </p>
          <Input
            type="password"
            placeholder={`New password (min ${MIN_FOCUS_PASSWORD_LENGTH} characters)`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="danger" loading={busy} onClick={() => void submitReset()}>
              Reset password
            </Button>
            <Button onClick={reset}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}
