import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '@/components/layout/Page';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { useLiveSettings, useSchedulingConfig } from '@/state/useLiveData';
import { setTheme, updateSchedulingConfig, updateSettings } from '@/services/settingsService';
import { ProfileSettings } from './ProfileSettings';
import { FocusPasswordSettings } from './FocusPasswordSettings';
import { AboutSettings } from './AboutSettings';
import { AppearanceSettings, TimerSettings, WorkingHoursSettings } from './GeneralSettings';
import {
  ProtectedTimeSettings, ReschedulingSettings, RevisionSettings, SchedulingSettings, XPSettings,
  AutoRescheduleModeSettings,
} from './SchedulingSettings';
import { DataSettings, NotificationSettings } from './DataSettings';
import { StorageSettings } from './StorageSettings';
import { ResetDataSettings } from './ResetDataSettings';
import { ConfigImportSettings } from './ConfigImportSettings';
import { StorageGuardCard } from './StorageGuardCard';
import { MaintenanceSettings } from './MaintenanceSettings';
import { InterfaceSettings, NotificationCenterSettings } from './InterfaceSettings';
import { useUiMode } from '@/lib/uiMode';
import { SoundSettings } from './SoundSettings';
import { DashboardSettings } from './DashboardSettings';
import { AgentSettings } from './AgentSettings';

const TAB_LABELS: Record<string, string> = {
  profile: 'Profile', focus: 'Focus', planning: 'Planning', appearance: 'Appearance', notifications: 'Notifications', agents: 'Agents', data: 'Data', about: 'About',
};
import type { DeepPartial, SchedulingConfig, Settings, ThemeMode } from '@/types';

type Tab = 'profile' | 'focus' | 'planning' | 'appearance' | 'notifications' | 'agents' | 'data' | 'about';
const ALL_TABS: Tab[] = ['profile', 'focus', 'planning', 'appearance', 'notifications', 'agents', 'data', 'about'];
/** Tabs only shown in Advanced mode. */
const ADVANCED_TABS = new Set<Tab>(['planning']);

/**
 * Settings, reorganized into iOS-style grouped sections. Every control here
 * writes to the persisted Settings row (or the profile row, or the focus-lock
 * store) and is read back live by the rest of the app — nothing is
 * display-only, and nothing here is decorative (no stat cards, no charts).
 *
 *   Profile      — display name, space name, working hours (study prefs)
 *   Focus        — Focus Mode password, timer/pomodoro defaults
 *   Planning     — scheduling, rescheduling, revision & XP, protected time,
 *                  notifications (auto-plan rule builder lands here later)
 *   Appearance   — theme, density, clock format, motion
 *   Data         — storage, export/import, snapshots, reset
 *   About        — version, blurb, reset to defaults
 */
export function SettingsPage() {
  const settings = useLiveSettings();
  const config = useSchedulingConfig();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (ALL_TABS.includes(params.get('tab') as Tab) ? params.get('tab') as Tab : 'profile'));
  const { advanced, setMode } = useUiMode();
  // A deep link to an advanced tab still works: it just shows that tab.
  const visibleTabs = ALL_TABS.filter((t) => advanced || !ADVANCED_TABS.has(t) || t === tab);
  const navigate = useNavigate();

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
          items={visibleTabs.map((t) => ({ value: t, label: TAB_LABELS[t] }))}
        />
      }
    >
      {tab === 'profile' ? (
        <>
          <ProfileSettings settings={settings} onPatch={patch} />
          <WorkingHoursSettings settings={settings} onPatch={patch} />
        </>
      ) : null}

      {tab === 'focus' ? (
        <>
          <FocusPasswordSettings />
          <TimerSettings settings={settings} onPatch={patch} />
        </>
      ) : null}

      {tab === 'planning' ? (
        <>
          <SchedulingSettings config={config} onPatch={patchConfig} />
          <AutoRescheduleModeSettings settings={settings} onPatch={patch} />
          <ReschedulingSettings config={config} onPatch={patchConfig} />
          <ProtectedTimeSettings />
          <RevisionSettings config={config} onPatch={patchConfig} />
          <XPSettings config={config} onPatch={patchConfig} />
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="t-section">Auto Plan rules</div>
                <p className="t-muted mt-0.5">
                  Define hard subject/day/time-window rules — e.g. Mathematics only 4–6 PM,
                  Mon–Fri. The planner will never place that subject outside its window.
                </p>
              </div>
              <Button onClick={() => navigate('/planning/rules')}>Open rule builder</Button>
            </div>
          </Card>
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

      {tab === 'appearance' ? (
        <>
          <InterfaceSettings />
          <DashboardSettings />
          <AppearanceSettings settings={settings} onPatch={patch} onTheme={changeTheme} />
        </>
      ) : null}

      {tab === 'notifications' ? (
        <>
          <NotificationSettings settings={settings} onPatch={patch} />
          <SoundSettings />
          <NotificationCenterSettings />
        </>
      ) : null}

      {tab === 'agents' ? <AgentSettings /> : null}

      {tab === 'data' ? (
        <>
          <StorageGuardCard />
          <StorageSettings settings={settings} />
          <DataSettings settings={settings} onPatch={patch} />
          <ConfigImportSettings />
          {advanced ? (
            <>
              <MaintenanceSettings settings={settings} />
              <ResetDataSettings />
            </>
          ) : null}
        </>
      ) : null}

      {!advanced ? (
        <div className="mt-2 flex flex-col items-center gap-2 text-center">
          <p className="t-meta max-w-md">Showing everyday settings. Planning tuning, maintenance and data reset live in Advanced mode.</p>
          <Button size="sm" variant="subtle" onClick={() => void setMode('advanced')}>Show advanced settings</Button>
        </div>
      ) : null}

      {tab === 'about' ? <AboutSettings /> : null}
    </Page>
  );
}
