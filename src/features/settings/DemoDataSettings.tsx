import { useEffect, useState } from 'react';
import { Database, RefreshCw, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/state/toastStore';
import { SettingsSection } from './SettingsSection';
import {
  clearAllData, dismissDemoOffer, isFreshInstall, loadDemoData, resetToDemoData,
  shouldOfferDemoData, type DemoDataSummary,
} from '@/db/seed/index';
import type { Settings } from '@/types';

type Action = 'load' | 'clear' | 'reset';

const LABELS: Record<Action, { title: string; confirm: string; body: string }> = {
  load: {
    title: 'Load the demo dataset?',
    confirm: 'Load demo data',
    body:
      'This replaces every record in the productivity tables — tasks, schedule, goals, sessions, papers, revision, habits, activity and XP — with a generated ten-week history. Mixing demo data with real data is not a supported state, so anything already stored will be gone.',
  },
  clear: {
    title: 'Clear all data?',
    confirm: 'Clear everything',
    body:
      'Deletes every task, block, goal, session, paper, revision entry, habit, activity and XP transaction, leaving a pristine empty install. Your preferences (theme, working hours, scheduling numbers) are kept. This cannot be undone — export first if you are unsure.',
  },
  reset: {
    title: 'Reset to demo data?',
    confirm: 'Reset to demo',
    body:
      'Clears everything, then regenerates the demo dataset anchored to today. Use this to refresh the sample dates after the demo has been sitting around for a while. Any real data you have entered will be destroyed.',
  },
};

/** A rough, monotonic progress readout — the write is one big transaction, so
 *  the stages are announced rather than measured. Honest about that. */
const STAGES = [
  'Generating the world…',
  'Writing records…',
  'Recomputing goal progress…',
  'Evaluating achievements and rewards…',
  'Rolling analytics snapshots…',
];

export function DemoDataSettings({ settings }: { settings: Settings }) {
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [stage, setStage] = useState(0);
  const [summary, setSummary] = useState<DemoDataSummary | null>(null);
  const [fresh, setFresh] = useState<boolean | null>(null);

  useEffect(() => { void isFreshInstall().then(setFresh); }, [busy]);

  const demo = settings.demo;
  const loadedAt = demo?.loadedAt ?? null;

  const run = async (action: Action) => {
    setPending(null);
    setBusy(action);
    setStage(0);
    const ticker = window.setInterval(
      () => setStage((s) => Math.min(STAGES.length - 1, s + 1)),
      700,
    );
    try {
      if (action === 'clear') {
        await clearAllData();
        setSummary(null);
        toast.success('All data cleared', 'You are back to an empty install.');
      } else {
        const result = action === 'load' ? await loadDemoData() : await resetToDemoData();
        setSummary(result);
        toast.success(
          action === 'load' ? 'Demo data loaded' : 'Reset to demo data',
          `${result.totalRecords.toLocaleString()} records across ${result.historyDays} days of history and ${result.futureDays} days ahead.`,
        );
      }
    } catch (e) {
      toast.error('Demo data failed', e instanceof Error ? e.message : String(e));
    } finally {
      window.clearInterval(ticker);
      setBusy(null);
    }
  };

  const counts = summary?.counts ?? null;

  return (
    <>
      <SettingsSection
        title="Demo data"
        description="A deterministic, internally-consistent sample world — roughly ten weeks of history through two weeks ahead, regenerated relative to today every time you load it. Useful for seeing what a populated LifeOS looks like before you commit your own data to it."
        action={
          loadedAt ? (
            <Badge tone="accent">Demo loaded</Badge>
          ) : fresh ? (
            <Badge tone="neutral">Empty install</Badge>
          ) : null
        }
      >
        <div className="flex items-start gap-2 rounded-md border border-caution/30 bg-caution/5 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
          <p className="text-sm text-ink-muted">
            Demo data and real data are not meant to be mixed. Loading or resetting <b>replaces</b>{' '}
            everything in the productivity tables. If you already have real records here, export a
            JSON backup from “Your data” above first.
          </p>
        </div>

        {loadedAt ? (
          <p className="t-meta">
            Demo dataset loaded {new Date(loadedAt).toLocaleString()} from seed{' '}
            <span className="t-num">{demo?.seed ?? '—'}</span>. The same seed always produces the
            same world; only the dates move with today.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            iconLeft={<Sparkles className="h-4 w-4" />}
            loading={busy === 'load'}
            disabled={busy !== null}
            onClick={() => setPending('load')}
          >
            Load demo data
          </Button>
          <Button
            iconLeft={<RefreshCw className="h-4 w-4" />}
            loading={busy === 'reset'}
            disabled={busy !== null}
            onClick={() => setPending('reset')}
          >
            Reset to demo data
          </Button>
          <Button
            variant="danger"
            iconLeft={<Trash2 className="h-4 w-4" />}
            loading={busy === 'clear'}
            disabled={busy !== null}
            onClick={() => setPending('clear')}
          >
            Clear all data
          </Button>
        </div>

        {busy ? (
          <div className="rounded-md border border-line bg-surface px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-ink">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
              {busy === 'clear' ? 'Clearing every table…' : STAGES[stage]}
            </div>
            <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line-faint">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${busy === 'clear' ? 60 : ((stage + 1) / STAGES.length) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        {counts ? (
          <div>
            <div className="t-label mb-1 flex items-center gap-1">
              <Database className="h-3 w-3" /> What was written
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(counts)
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([table, n]) => (
                  <Badge key={table} tone="neutral">{table}: {n.toLocaleString()}</Badge>
                ))}
            </div>
          </div>
        ) : null}
      </SettingsSection>

      <DemoConfirm
        action={pending}
        onClose={() => setPending(null)}
        onConfirm={() => void run(pending!)}
      />
    </>
  );
}

/** Two-step confirmation: the copy names exactly what is destroyed. */
function DemoConfirm({
  action, onClose, onConfirm,
}: { action: Action | null; onClose: () => void; onConfirm: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => { setAcknowledged(false); }, [action]);
  const copy = action ? LABELS[action] : null;

  return (
    <Modal
      open={action !== null}
      onClose={onClose}
      size="sm"
      persistent
      title={copy?.title ?? ''}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!acknowledged} onClick={onConfirm}>
            {copy?.confirm ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">{copy?.body}</p>
      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-line bg-surface px-3 py-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-accent))]"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span className="text-sm text-ink-muted">
          I understand this replaces the data currently stored in this browser.
        </span>
      </label>
    </Modal>
  );
}

/**
 * First-run offer. Shown once, only on a genuinely empty install, so nothing
 * can be overwritten silently. Mounted next to the router in App.
 */
export function FirstRunDemoPrompt() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void shouldOfferDemoData().then(setOpen).catch(() => setOpen(false));
  }, []);

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) { setOpen(false); void dismissDemoOffer(); } }}
      size="sm"
      title="Start with demo data?"
      footer={
        <>
          <Button
            disabled={busy}
            onClick={() => { setOpen(false); void dismissDemoOffer(); }}
          >
            Start empty
          </Button>
          <Button
            variant="primary"
            loading={busy}
            iconLeft={<Sparkles className="h-4 w-4" />}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await loadDemoData();
                toast.success('Demo data loaded', `${result.totalRecords.toLocaleString()} records written.`);
                setOpen(false);
              } catch (e) {
                toast.error('Demo data failed', e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Load demo data
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        This install is empty. LifeOS can generate about ten weeks of realistic sample history —
        tasks, schedule, goals, focus sessions, papers, revision, habits and XP — so every screen
        has something to show while you look around.
      </p>
      <p className="t-meta mt-2">
        You can load, reset or clear it at any time from Settings → Data. Choosing “Start empty”
        will not ask again.
      </p>
    </Modal>
  );
}
