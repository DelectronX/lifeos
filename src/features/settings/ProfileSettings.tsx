import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { db } from '@/db/db';
import { useLiveProfile } from '@/state/useLiveData';
import { SettingRow, SettingsSection } from './SettingsSection';
import type { Settings } from '@/types';

export type Patch = (patch: Partial<Omit<Settings, 'id'>>) => void | Promise<void>;

const MAX_NAME_LENGTH = 40;

/**
 * Profile & personalization: who you are (display name, used in greetings
 * and the sidebar identity block) and what this install is called (space
 * name, used everywhere the app would otherwise say "LifeOS"). Both write
 * through the app's existing storage paths so nothing new was invented:
 * displayName lives on the singleton UserProfile row (already read by
 * xpService/IdentityBlock), spaceName lives on Settings.
 */
export function ProfileSettings({ settings, onPatch }: { settings: Settings; onPatch: Patch }) {
  const profile = useLiveProfile();
  const [displayName, setDisplayName] = useState('');
  const [spaceName, setSpaceName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingSpace, setSavingSpace] = useState(false);

  // Fill from the live record once it loads; do not clobber in-progress typing.
  useEffect(() => { if (profile) setDisplayName((prev) => prev || profile.displayName); }, [profile]);
  useEffect(() => { setSpaceName((prev) => prev || (settings.spaceName ?? '')); }, [settings.spaceName]);

  const saveDisplayName = async () => {
    const trimmed = displayName.trim();
    if (trimmed.length === 0) { toast.error('Display name required', 'Enter a name to save.'); return; }
    if (trimmed.length > MAX_NAME_LENGTH) { toast.error('Too long', `Keep it under ${MAX_NAME_LENGTH} characters.`); return; }
    setSavingName(true);
    try {
      await db.profile.update('profile', { displayName: trimmed, updatedAt: Date.now() });
      toast.success('Display name saved');
    } finally {
      setSavingName(false);
    }
  };

  const saveSpaceName = async () => {
    const trimmed = spaceName.trim();
    if (trimmed.length > MAX_NAME_LENGTH) { toast.error('Too long', `Keep it under ${MAX_NAME_LENGTH} characters.`); return; }
    setSavingSpace(true);
    try {
      await onPatch({ spaceName: trimmed });
      toast.success('Space name saved', trimmed ? `Now called "${trimmed}".` : 'Reset to "LifeOS".');
    } finally {
      setSavingSpace(false);
    }
  };

  return (
    <SettingsSection
      title="Profile"
      description="Your name and what this install is called. Both update everywhere immediately — the sidebar, window title and greetings all read these live."
    >
      <SettingRow label="Display name" hint="Used in the Home greeting and the sidebar identity card.">
        <div className="flex items-center gap-2">
          <Input
            value={displayName}
            placeholder="Your name"
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button size="sm" loading={savingName} onClick={() => void saveDisplayName()}>
            Save
          </Button>
        </div>
      </SettingRow>

      <SettingRow
        label="Space name"
        hint={'The app\'s name, shown in the sidebar and window title — e.g. "Aksh\'s Study Space". Leave empty for "LifeOS".'}
      >
        <div className="flex items-center gap-2">
          <Input
            value={spaceName}
            placeholder="LifeOS"
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setSpaceName(e.target.value)}
          />
          <Button size="sm" loading={savingSpace} onClick={() => void saveSpaceName()}>
            Save
          </Button>
        </div>
      </SettingRow>

      <p className="t-meta">
        Avatar upload is not built yet — it needs a small image-storage layer of its own. Noted as
        a follow-up rather than built half-way here.
      </p>
    </SettingsSection>
  );
}
