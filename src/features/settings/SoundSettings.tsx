import { useEffect, useState } from 'react';
import { Play, Volume1, Volume2, VolumeX } from 'lucide-react';
import { Toggle } from '@/components/ui/Input';
import { toast } from '@/state/toastStore';
import { onSoundPrefsChange, playCue, readSoundPrefs, SOUND_CUES, writeSoundPrefs, type SoundCue } from '@/lib/sounds';
import { SettingRow, SettingsSection } from './SettingsSection';

/** Alert sounds: master switch, volume, per-cue toggle with a preview button. */
export function SoundSettings() {
  const [prefs, setPrefs] = useState(readSoundPrefs);
  useEffect(() => onSoundPrefsChange(() => setPrefs(readSoundPrefs())), []);

  const preview = (cue: SoundCue) => {
    const r = playCue(cue, { force: true, volume: prefs.volume });
    if (r === 'unsupported') toast.warning('Sound is not supported in this browser');
    else if (r === 'locked') toast.warning('Audio is blocked', 'Click anywhere in LifeOS once, then try again.');
  };
  const VolIcon = !prefs.enabled || prefs.volume === 0 ? VolumeX : prefs.volume < 0.5 ? Volume1 : Volume2;

  return (
    <SettingsSection
      title="Sounds"
      description="Short, quiet chimes for reminders and alerts. They respect quiet hours, never repeat the same sound within a few seconds, and only play after you've interacted with LifeOS (a browser rule)."
    >
      <Toggle label="Alert sounds" description="Master switch." checked={prefs.enabled} onChange={(v) => setPrefs(writeSoundPrefs({ enabled: v }))} />
      <SettingRow label="Volume" hint={`${Math.round(prefs.volume * 100)}%`}>
        <div className="flex items-center gap-3">
          <VolIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
          <input
            type="range" min={0} max={100} step={5} aria-label="Alert volume"
            disabled={!prefs.enabled}
            value={Math.round(prefs.volume * 100)}
            onChange={(e) => setPrefs(writeSoundPrefs({ volume: Number(e.target.value) / 100 }))}
            onPointerUp={() => preview('schedule')}
            onKeyUp={(e) => { if (e.key.startsWith('Arrow')) preview('schedule'); }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink/15 accent-[rgb(var(--c-accent))] disabled:opacity-40"
          />
        </div>
      </SettingRow>
      {SOUND_CUES.map((c) => (
        <div key={c.id} className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => preview(c.id)}
            aria-label={`Preview ${c.label} sound`}
            className="touch-hit grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink/[0.07] text-ink-muted transition-colors hover:bg-accent/15 hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />
          </button>
          <Toggle
            className="flex-1"
            label={c.label}
            description={c.detail}
            disabled={!prefs.enabled}
            checked={prefs.cues[c.id]}
            onChange={(v) => setPrefs(writeSoundPrefs({ cues: { ...prefs.cues, [c.id]: v } }))}
          />
        </div>
      ))}
    </SettingsSection>
  );
}
