// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SOUND_PREFS, playCue, readSoundPrefs, writeSoundPrefs, __resetSoundThrottle } from '@/lib/sounds';

describe('alert sounds', () => {
  beforeEach(() => { localStorage.clear(); __resetSoundThrottle(); });

  it('defaults, persists and clamps preferences', () => {
    expect(readSoundPrefs()).toEqual(DEFAULT_SOUND_PREFS);
    writeSoundPrefs({ volume: 3, cues: { ...DEFAULT_SOUND_PREFS.cues, completion: true } });
    const p = readSoundPrefs();
    expect(p.volume).toBe(1);
    expect(p.cues.completion).toBe(true);
    expect(p.cues.schedule).toBe(true);
  });

  it('honours the master switch and per-cue toggles', () => {
    writeSoundPrefs({ enabled: false });
    expect(playCue('schedule')).toBe('disabled');
    writeSoundPrefs({ enabled: true, cues: { ...DEFAULT_SOUND_PREFS.cues, warning: false } });
    expect(playCue('warning')).toBe('muted-cue');
  });

  it('never plays without Web Audio (jsdom) — reports instead of throwing', () => {
    expect(['unsupported', 'locked']).toContain(playCue('schedule'));
  });
});
