import { useState } from 'react';
import { Page } from '@/components/layout/Page';
import { Tabs } from '@/components/ui/Tabs';
import { TimerSetup } from './TimerSetup';
import { ActiveTimerPanel } from './ActiveTimerPanel';
import { SessionHistory } from './SessionHistory';
import { PaperList } from './PaperList';
import { useTimerEngine, useTimerStore } from '@/state/useTimer';

type TabKey = 'timer' | 'papers' | 'history';

/**
 * Focus module. The timer engine is mounted here once — the running snapshot
 * lives in the store and is restored from localStorage, so leaving and coming
 * back (or refreshing) never loses a session.
 */
export function FocusPage() {
  useTimerEngine();
  const snapshot = useTimerStore((s) => s.snapshot);
  const [tab, setTab] = useState<TabKey>('timer');

  return (
    <Page
      title="Focus"
      subtitle="Timers that record real sessions against your tasks, goals and trackers."
      toolbar={
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'timer' as const, label: 'Timer' },
            { value: 'papers' as const, label: 'Paper mode' },
            { value: 'history' as const, label: 'History' },
          ]}
        />
      }
    >
      {tab === 'timer' ? (
        <div className="mx-auto max-w-2xl space-y-5">
          {snapshot ? <ActiveTimerPanel /> : null}
          {snapshot ? (
            <p className="t-meta text-center">
              Stop the timer to record the session. It keeps counting if you switch tabs or refresh.
            </p>
          ) : (
            <TimerSetup />
          )}
        </div>
      ) : null}

      {tab === 'papers' ? <PaperList /> : null}
      {tab === 'history' ? <SessionHistory /> : null}
    </Page>
  );
}
