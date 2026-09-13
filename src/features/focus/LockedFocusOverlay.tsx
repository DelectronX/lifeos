import { useEffect, useState } from 'react';
import { Info, Lock, ShieldAlert, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tooltip } from '@/components/ui/Tooltip';
import { ActiveTimerPanel } from './ActiveTimerPanel';
import { useTimerReading, useTimerStore } from '@/state/useTimer';
import { useFocusLockStore } from '@/state/focusLockStore';
import { clearFocusPassword, setFocusPassword, verifyFocusPassword } from '@/services/focusLockService';
import { toast } from '@/state/toastStore';
import type { FinishTimerResult } from '@/services/timerService';
import { formatDuration } from '@/lib/date';

/**
 * LockedFocusOverlay — an in-app "distraction lock" for a running Focus
 * session.
 *
 * HONESTY NOTE (do not remove or soften): this is a full-screen overlay
 * rendered above the normal app shell, so there is nothing else in this web
 * app to navigate to while it's up. It is NOT, and cannot be, iOS's real
 * system-level Guided Access — an ordinary web/Capacitor app has no API to
 * block the physical Home button, App Switcher gesture, or Control Centre.
 * A determined user can always leave via those. The in-UI copy below says
 * this explicitly; never replace it with a claim of stronger control, and
 * never render a fake "Guided Access: Enabled" style status badge.
 *
 * Mounted once at the app root (see App.tsx) so it renders above
 * AppShell's sidebar/tab bar regardless of route.
 */
export function LockedFocusOverlay() {
  const lockedSessionId = useFocusLockStore((s) => s.lockedSessionId);
  const unlock = useFocusLockStore((s) => s.unlock);
  const { snapshot } = useTimerReading();
  const stop = useTimerStore((s) => s.stop);

  const [mode, setMode] = useState<'idle' | 'exit' | 'forgot'>('idle');
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  // Self-heal: if the lock outlives its session (finished/discarded from
  // elsewhere, e.g. the timer reached zero and the completion path already
  // ran), drop the lock rather than showing an overlay with nothing behind it.
  useEffect(() => {
    if (lockedSessionId && (!snapshot || snapshot.id !== lockedSessionId)) {
      unlock();
    }
  }, [lockedSessionId, snapshot, unlock]);

  const active = Boolean(lockedSessionId && snapshot && snapshot.id === lockedSessionId);
  if (!active) return null;

  const reset = () => { setMode('idle'); setPassword(''); setNext(''); setConfirm(''); };

  const report = (result: FinishTimerResult | null, title: string) => {
    if (!result) { toast.show('Nothing recorded', 'The session was too short to log.'); return; }
    const minutes = Math.round(result.session.workMs / 60_000);
    const xp = result.xpAwarded > 0 ? ` · +${result.xpAwarded} XP` : '';
    toast.success(title, `${formatDuration(minutes)} tracked${xp}`);
  };

  // Finishing normally never requires the password — only bailing early does.
  const finishNormally = async () => {
    const result = await stop({ completed: true });
    unlock();
    report(result, 'Session recorded');
  };

  const submitExit = async () => {
    setBusy(true);
    try {
      const ok = await verifyFocusPassword(password);
      if (!ok) { toast.error('Incorrect password'); return; }
      const result = await stop({ completed: false });
      unlock();
      reset();
      report(result, 'Session ended early');
    } finally {
      setBusy(false);
    }
  };

  const submitForgotReset = async () => {
    if (next !== confirm) { toast.error('Passwords do not match', 'Re-enter both fields.'); return; }
    setBusy(true);
    try {
      await clearFocusPassword();
      const result = await setFocusPassword(next);
      if (!result.ok) { toast.error('Could not set password', result.error); return; }
      // Resetting the password is, by design, an unlock: there is no second
      // factor to verify identity against, so the only honest recovery path
      // is "reset and end the session incomplete" rather than pretending to
      // resume the lock as if nothing happened.
      const stopped = await stop({ completed: false });
      unlock();
      reset();
      toast.success('Focus password reset', 'The session ended early because the lock was reset.');
      report(stopped, 'Session ended early');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-surface-base">
      <div className="flex items-center gap-2 border-b border-line bg-surface-raised px-4 py-3">
        <Lock className="h-4 w-4 text-accent" />
        <span className="text-sm font-medium text-ink">Locked focus session</span>
        <Tooltip
          side="bottom"
          label={
            <span className="block max-w-xs whitespace-normal">
              This only restricts navigation inside LifeOS. It is not Apple's Guided Access and
              cannot block your device's Home button or app switcher. For a real system-level
              lock: Settings → Accessibility → Guided Access, then triple-click the side button
              and tap Start.
            </span>
          }
        >
          <button type="button" aria-label="What does locking do?" className="text-ink-faint hover:text-ink">
            <Info className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4">
        <ActiveTimerPanel />

        <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
          <p className="t-meta flex items-start gap-1.5">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              In-app lock only — this cannot stop you pressing your device's physical Home/side
              button. For that, use iOS's own Guided Access (Settings → Accessibility → Guided
              Access → triple-click side button → Start).
            </span>
          </p>
        </div>

        {mode === 'idle' ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => void finishNormally()}>Finish session</Button>
            <Button variant="secondary" iconLeft={<Unlock className="h-4 w-4" />} onClick={() => setMode('exit')}>
              Exit early
            </Button>
          </div>
        ) : null}

        {mode === 'exit' ? (
          <div className="space-y-2 rounded-md border border-line bg-surface px-3 py-3">
            <p className="t-meta">Enter your Focus password to end this session early.</p>
            <Input
              type="password"
              placeholder="Focus password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" loading={busy} onClick={() => void submitExit()}>
                End session
              </Button>
              <Button onClick={reset}>Cancel</Button>
              <Button variant="ghost" onClick={() => setMode('forgot')}>Forgot password?</Button>
            </div>
          </div>
        ) : null}

        {mode === 'forgot' ? (
          <div className="space-y-2 rounded-md border border-caution/30 bg-caution/5 px-3 py-3">
            <p className="text-sm text-caution">
              There is no recovery for a forgotten Focus password — only reset. Resetting it here
              ends this session early (incomplete) rather than silently letting you back in, and
              replaces the old password immediately.
            </p>
            <Input
              type="password"
              placeholder="New password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" loading={busy} onClick={() => void submitForgotReset()}>
                Reset password and end session
              </Button>
              <Button onClick={reset}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
