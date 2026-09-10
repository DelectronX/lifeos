import { useMemo, useState } from 'react';
import { Page } from '@/components/layout/Page';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { useLiveSettings, useSchedulingConfig } from '@/state/useLiveData';
import { setTheme, updateSchedulingConfig, updateSettings } from '@/services/settingsService';
import { DEFAULT_SCHEDULING_CONFIG } from '@/config/schedulingConfig';
import { ResourceLibrary } from '@/components/resource/ResourceLibrary';
import { AppearanceSettings, TimerSettings, WorkingHoursSettings } from './GeneralSettings';
import {
  ProtectedTimeSettings, ReschedulingSettings, RevisionSettings, SchedulingSettings, XPSettings,
} from './SchedulingSettings';
import { DataSettings, NotificationSettings } from './DataSettings';
import type { DeepPartial, SchedulingConfig, Settings, ThemeMode } from '@/types';

type Tab = 'general' | 'scheduling' | 'revision' | 'notifications' | 'resources' | 'data';

/**
 * Settings. Every control on this page writes to the persisted Settings row
 * and is read back by the rest of the app — there are no display-only toggles.
 * Scheduling numbers land in `settings.scheduling` as a partial override that
 * is merged over DEFAULT_SCHEDULING_CONFIG wherever an engine runs.
 */
export function SettingsPage() {
  const settings = useLiveSettings();
  const config = useSchedulingConfig();
  const [tab, setTab] = useState<Tab>('general');

  const patch = useMemo(
    () => async (next: Partial<Omit<Settings, 'id'>>) => {
      try {
        await updateSettings(next);
      } catch (e) {
        toast.error('Could not save', e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const patchConfig = useMemo(
    () => async (next: DeepPartial<SchedulingConfig>) => {
      try {
        await updateSchedulingConfig(next);
      } catch (e) {
        toast.error('Could not save', e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const changeTheme = async (mode: ThemeMode) => {
    await setTheme(mode);
  };

  if (!settings) {
    return (
      <Page title="Settings" subtitle="Loading your preferences…">
        <Card>
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Settings"
      subtitle="Everything here is stored locally and read by the rest of the app immediately."
      toolbar={
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'general' as const, label: 'General' },
            { value: 'scheduling' as const, label: 'Scheduling' },
            { value: 'revision' as const, label: 'Revision & XP' },
            { value: 'notifications' as const, label: 'Notifications' },
            { value: 'resources' as const, label: 'Resources' },
            { value: 'data' as const, label: 'Data' },
          ]}
        />
      }
    >
      {tab === 'general' ? (
        <>
          <AppearanceSettings settings={settings} onPatch={patch} onTheme={changeTheme} />
          <WorkingHoursSettings settings={settings} onPatch={patch} />
          <TimerSettings settings={settings} onPatch={patch} />
        </>
      ) : null}

      {tab === 'scheduling' ? (
        <>
          <SchedulingSettings config={config} onPatch={patchConfig} />
          <ReschedulingSettings config={config} onPatch={patchConfig} />
          <ProtectedTimeSettings />
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="t-section">Reset scheduling configuration</div>
                <p className="t-muted mt-0.5">
                  Restores every scheduling, break, rescheduling, revision and XP number to its
                  default. Your tasks, schedule and history are untouched.
                </p>
              </div>
              <Button
                variant="danger"
                onClick={async () => {
                  await updateSettings({ scheduling: {} });
                  toast.success('Scheduling configuration reset', 'Back to the shipped defaults.');
                }}
              >
                Reset to defaults
              </Button>
            </div>
          </Card>
        </>
      ) : null}

      {tab === 'revision' ? (
        <>
          <RevisionSettings config={config} onPatch={patchConfig} />
          <XPSettings config={config} onPatch={patchConfig} />
          <Card>
            <div className="t-section">How these numbers are used</div>
            <p className="t-muted mt-1">
              Revision intervals seed each new RevisionPlan's ladder; the SM-2 ease factor then
              adapts per plan from your recall quality. XP awards are applied once per real event
              with a dedupe key, and both the per-event and daily ceilings are enforced at write
              time — the default daily ceiling is {DEFAULT_SCHEDULING_CONFIG.xp.dailyTotalCap} XP.
            </p>
          </Card>
        </>
      ) : null}

      {tab === 'notifications' ? (
        <NotificationSettings settings={settings} onPatch={patch} />
      ) : null}

      {tab === 'resources' ? (
        <Card>
          <div className="mb-3">
            <div className="t-section">Resource library</div>
            <p className="t-muted mt-0.5">
              Every file and link you have attached anywhere. Files are held as Blobs in this
              browser's IndexedDB — nothing is ever uploaded.
            </p>
          </div>
          <ResourceLibrary />
        </Card>
      ) : null}

      {tab === 'data' ? <DataSettings settings={settings} onPatch={patch} /> : null}
    </Page>
  );
}
