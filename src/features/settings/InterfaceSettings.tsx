import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Toggle, Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { setStageBackground, useStageBackground, useUiMode } from '@/lib/uiMode';
import {
  NOTIFICATION_CATEGORIES, useNotificationStore,
} from '@/state/notificationStore';
import { SettingRow, SettingsSection, hhmmToMinutes, minutesToHHMM } from './SettingsSection';

/** Interface mode + stage background. */
export function InterfaceSettings() {
  const { mode, setMode } = useUiMode();
  const background = useStageBackground();
  return (
    <SettingsSection
      title="Interface"
      description="Simple keeps LifeOS to everyday destinations and settings. Advanced reveals planning rules, raw areas, analytics, maintenance and every tuning control. Nothing is removed — only shown or hidden."
    >
      <SettingRow label="Mode" hint={mode === 'simple' ? 'Everyday destinations and settings.' : 'Everything, including power tools.'}>
        <SegmentedControl
          aria-label="Interface mode"
          fullWidth
          value={mode}
          onChange={(v) => void setMode(v)}
          items={[{ value: 'simple', label: 'Simple' }, { value: 'advanced', label: 'Advanced' }]}
        />
      </SettingRow>
      <SettingRow label="Background" hint="The animated ASCII galaxy behind every screen. Still shows one frame; Off is plain charcoal.">
        <SegmentedControl
          aria-label="Background"
          fullWidth
          value={background}
          onChange={(v) => void setStageBackground(v)}
          items={[{ value: 'galaxy', label: 'Galaxy' }, { value: 'still', label: 'Still' }, { value: 'off', label: 'Off' }]}
        />
      </SettingRow>
    </SettingsSection>
  );
}

/** In-app notification preferences: banners per category, quiet hours, history. */
export function NotificationCenterSettings() {
  const prefs = useNotificationStore((s) => s.prefs);
  const setPrefs = useNotificationStore((s) => s.setPrefs);
  const count = useNotificationStore((s) => s.items.length);
  const clear = useNotificationStore((s) => s.clear);
  const quiet = prefs.quietFrom !== null && prefs.quietTo !== null;

  return (
    <>
      <SettingsSection
        title="Banners"
        description="Everything LifeOS notices is filed in the Notification Center (the bell). Choose which kinds also appear as a floating banner. Errors and undo prompts always show."
      >
        {NOTIFICATION_CATEGORIES.map((c) => (
          <Toggle
            key={c.id}
            checked={prefs.banners[c.id] !== false}
            onChange={(v) => setPrefs({ banners: { ...prefs.banners, [c.id]: v } })}
            label={c.label}
            description={c.detail}
          />
        ))}
      </SettingsSection>

      <SettingsSection title="Quiet hours" description="No banners during this window; notifications are still filed in the Center.">
        <Toggle
          checked={quiet}
          onChange={(v) => setPrefs(v ? { quietFrom: 22 * 60, quietTo: 7 * 60 } : { quietFrom: null, quietTo: null })}
          label="Quiet hours"
          description={quiet ? `${minutesToHHMM(prefs.quietFrom as number)} – ${minutesToHHMM(prefs.quietTo as number)}` : 'Off'}
        />
        {quiet ? (
          <SettingRow label="From – to">
            <div className="grid grid-cols-2 gap-2">
              <Input type="time" aria-label="Quiet from" value={minutesToHHMM(prefs.quietFrom as number)} onChange={(e) => setPrefs({ quietFrom: hhmmToMinutes(e.target.value, prefs.quietFrom as number) })} />
              <Input type="time" aria-label="Quiet to" value={minutesToHHMM(prefs.quietTo as number)} onChange={(e) => setPrefs({ quietTo: hhmmToMinutes(e.target.value, prefs.quietTo as number) })} />
            </div>
          </SettingRow>
        ) : null}
        <Toggle
          checked={prefs.system}
          onChange={(v) => setPrefs({ system: v })}
          label="Also notify the system when LifeOS is in the background"
          description="Uses the browser notification permission below. Nothing leaves this device."
        />
      </SettingsSection>

      <SettingsSection title="History" description={`${count} notification${count === 1 ? '' : 's'} stored in this browser (newest 250 kept).`}>
        <div className="flex justify-end">
          <Button size="sm" variant="danger" disabled={!count} onClick={clear}>Clear history</Button>
        </div>
      </SettingsSection>
    </>
  );
}
