import { describe, expect, it } from 'vitest';
import { desktopAllowed, planDelivery } from '@/services/notificationCenter';
import type { Settings } from '@/types';

const base: Settings['notifications'] = { enabled: true, blockStart: true, breakEnd: false, revisionDue: true, dailyReviewHour: 21 };

describe('notification delivery', () => {
  it('desktop only in the background by default, banner always available', () => {
    const visible = planDelivery({ kind: 'blockUpcoming', banner: true, settings: base, quiet: false, appVisible: true, permission: 'granted' });
    expect(visible).toEqual({ banner: true, desktop: false, sound: 'schedule' });
    const hidden = planDelivery({ kind: 'blockUpcoming', banner: true, settings: base, quiet: false, appVisible: false, permission: 'granted' });
    expect(hidden.desktop).toBe(true);
    const front = planDelivery({ kind: 'blockUpcoming', banner: true, settings: { ...base, desktopWhenVisible: true }, quiet: false, appVisible: true, permission: 'granted' });
    expect(front.desktop).toBe(true);
  });

  it('respects permission, the master switch, per-kind toggles and quiet hours', () => {
    const p = (over: Partial<Parameters<typeof planDelivery>[0]>) => planDelivery({ kind: 'achievement', banner: true, settings: base, quiet: false, appVisible: false, permission: 'granted', ...over });
    expect(p({ permission: 'denied' }).desktop).toBe(false);
    expect(p({ permission: 'unsupported' }).desktop).toBe(false);
    expect(p({ settings: { ...base, enabled: false } }).desktop).toBe(false);
    expect(p({ settings: { ...base, achievements: false } }).desktop).toBe(false);
    const quiet = p({ quiet: true });
    expect(quiet.desktop).toBe(false);
    expect(quiet.sound).toBeNull();
  });

  it('routine completions are silent unless the user opted in', () => {
    const r = planDelivery({ kind: 'completion', banner: false, settings: base, quiet: false, appVisible: false, permission: 'granted' });
    expect(r).toEqual({ banner: false, desktop: false, sound: null });
    const opted = planDelivery({ kind: 'completion', banner: false, settings: { ...base, completions: true }, quiet: false, appVisible: false, permission: 'granted' });
    expect(opted.desktop).toBe(true);
    expect(opted.sound).toBe('completion');
  });

  it('maps kinds to the existing toggles', () => {
    expect(desktopAllowed('revision', { ...base, revisionDue: false })).toBe(false);
    expect(desktopAllowed('breakEnd', { ...base, breakEnd: true })).toBe(true);
    expect(desktopAllowed('blockStart', { ...base, blockStart: false })).toBe(false);
    expect(desktopAllowed('blockMissed', base)).toBe(true);
    expect(desktopAllowed('info', base)).toBe(false);
  });

  it('warnings use the warning cue, achievements the achievement cue', () => {
    const go = (kind: Parameters<typeof planDelivery>[0]['kind']) => planDelivery({ kind, banner: true, settings: base, quiet: false, appVisible: true, permission: 'default' }).sound;
    expect(go('blockMissed')).toBe('warning');
    expect(go('deadline')).toBe('warning');
    expect(go('achievement')).toBe('achievement');
    expect(go('task')).toBe('task');
  });
});
