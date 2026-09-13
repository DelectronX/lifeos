import { Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { updateSettings } from '@/services/settingsService';
import { SettingRow, SettingsSection } from './SettingsSection';

/**
 * Bumped by hand alongside releases — see package.json's `version`. Kept as a
 * plain constant rather than a build-time define so it works identically in
 * dev, build and test without extra Vite config.
 */
export const APP_VERSION = '1.0.0';

export function AboutSettings() {
  return (
    <SettingsSection
      title="About"
      description="A few facts about this install."
      action={<Info className="h-4 w-4 text-ink-faint" />}
    >
      <SettingRow label="Version">
        <span className="t-num text-sm text-ink">{APP_VERSION}</span>
      </SettingRow>

      <p className="t-meta">
        LifeOS is an offline-first personal productivity system — tasks, schedule, goals,
        revision, timers and analytics all in one local, private install with no account and no
        server. Everything you see is computed from records stored on this device.
      </p>

      <SettingRow label="Reset to defaults" hint="Restores your space name to LifeOS. Theme, working hours and scheduling numbers each have their own reset controls where they live.">
        <Button
          variant="danger"
          onClick={async () => {
            await updateSettings({ spaceName: '' });
            toast.success('Space name reset', 'Back to "LifeOS".');
          }}
        >
          Reset space name
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}
