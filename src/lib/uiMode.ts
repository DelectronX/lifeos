import { useCallback } from 'react';
import { useLiveSettings } from '@/state/useLiveData';
import { getSettings, updateSettings } from '@/services/settingsService';
import type { StageBackground, UiMode } from '@/types';

/**
 * Simple vs Advanced. A preference, stored in settings.appearance like every
 * other one. Simple keeps the app to everyday destinations and the settings a
 * person actually changes; Advanced reveals planning rules, raw trackers,
 * analytics, maintenance and every tuning knob. Nothing is deleted or
 * disabled by Simple — it is only out of sight.
 */
export const DEFAULT_UI_MODE: UiMode = 'simple';
export const DEFAULT_STAGE_BACKGROUND: StageBackground = 'galaxy';

/** Normalises stored values (incl. retired ones) to a current option. */
export function normaliseBackground(v: unknown): StageBackground {
  return v === 'off' || v === 'still' || v === 'galaxy' ? v : DEFAULT_STAGE_BACKGROUND;
}

export async function setUiMode(mode: UiMode): Promise<void> {
  const s = await getSettings();
  await updateSettings({ appearance: { ...(s.appearance ?? { density: 'comfortable', use24HourClock: false, reduceMotion: false }), mode } });
}

export async function setStageBackground(background: StageBackground): Promise<void> {
  const s = await getSettings();
  await updateSettings({ appearance: { ...(s.appearance ?? { density: 'comfortable', use24HourClock: false, reduceMotion: false }), background } });
}

export function useUiMode(): { mode: UiMode; advanced: boolean; setMode: (m: UiMode) => Promise<void> } {
  const settings = useLiveSettings();
  const mode = settings?.appearance?.mode ?? DEFAULT_UI_MODE;
  const setMode = useCallback((m: UiMode) => setUiMode(m), []);
  return { mode, advanced: mode === 'advanced', setMode };
}

export function useStageBackground(): StageBackground {
  const settings = useLiveSettings();
  return normaliseBackground(settings?.appearance?.background);
}
