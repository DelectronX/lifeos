import { Trash2 } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Select, Toggle } from '@/components/ui/Input';
import { weekdayName } from '@/lib/date';
import { SettingRow, SettingsSection, clampNumber, hhmmToMinutes, minutesToHHMM } from './SettingsSection';
import type { Settings, ThemeMode, TimeRange, WorkingHours } from '@/types';
import {
  DEFAULT_APPEARANCE_PREFERENCES, DEFAULT_TIMER_PREFERENCES,
} from '@/types';

export type Patch = (patch: Partial<Omit<Settings, 'id'>>) => void | Promise<void>;

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

export function AppearanceSettings({
  settings, onPatch, onTheme,
}: {
  settings: Settings;
  onPatch: Patch;
  onTheme: (mode: ThemeMode) => void | Promise<void>;
}) {
  const appearance = { ...DEFAULT_APPEARANCE_PREFERENCES, ...(settings.appearance ?? {}) };

  return (
    <SettingsSection
      title="Appearance"
      description="Theme and presentation. These apply immediately across the app."
    >
      <SettingRow label="Theme" hint="System follows your operating system setting.">
        <Select value={settings.theme} onChange={(e) => void onTheme(e.target.value as ThemeMode)}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
      </SettingRow>

      <SettingRow label="Week starts on" hint="Used by the week view, weekly review and analytics.">
        <Select
          value={String(settings.weekStartsOn)}
          onChange={(e) => void onPatch({ weekStartsOn: Number(e.target.value) === 0 ? 0 : 1 })}
        >
          <option value="1">Monday</option>
          <option value="0">Sunday</option>
        </Select>
      </SettingRow>

      <SettingRow label="Clock format">
        <Select
          value={appearance.use24HourClock ? '24' : '12'}
          onChange={(e) =>
            void onPatch({ appearance: { ...appearance, use24HourClock: e.target.value === '24' } })
          }
        >
          <option value="12">12-hour (9:30 AM)</option>
          <option value="24">24-hour (09:30)</option>
        </Select>
      </SettingRow>

      <SettingRow label="Density" hint="Compact tightens list spacing on large screens.">
        <Select
          value={appearance.density}
          onChange={(e) =>
            void onPatch({ appearance: { ...appearance, density: e.target.value === 'compact' ? 'compact' : 'comfortable' } })
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </Select>
      </SettingRow>

      <Toggle
        label="Reduce motion"
        description="Disables entrance animations and transitions."
        checked={appearance.reduceMotion}
        onChange={(v) => void onPatch({ appearance: { ...appearance, reduceMotion: v } })}
      />
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Working hours & focus hours                                         */
/* ------------------------------------------------------------------ */

export function WorkingHoursSettings({
  settings, onPatch,
}: {
  settings: Settings;
  onPatch: Patch;
}) {
  const hours = settings.workingHours ?? {};

  const setRange = (day: number, index: number, patch: Partial<TimeRange>) => {
    const next: WorkingHours = { ...hours };
    const ranges = [...(next[day] ?? [])];
    ranges[index] = { ...ranges[index]!, ...patch };
    next[day] = ranges;
    void onPatch({ workingHours: next });
  };

  const addRange = (day: number) => {
    const next: WorkingHours = { ...hours };
    next[day] = [...(next[day] ?? []), { startMinute: 9 * 60, endMinute: 17 * 60 }];
    void onPatch({ workingHours: next });
  };

  const removeRange = (day: number, index: number) => {
    const next: WorkingHours = { ...hours };
    next[day] = (next[day] ?? []).filter((_, i) => i !== index);
    void onPatch({ workingHours: next });
  };

  const focusHours = settings.focusHours ?? [];

  return (
    <SettingsSection
      title="Working hours"
      description="The only time the scheduler will ever place work. Outside these ranges nothing is proposed."
    >
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
          <div key={day} className="flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-0">
            <span className="w-24 shrink-0 text-sm font-medium text-ink">{weekdayName(day)}</span>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {(hours[day] ?? []).length === 0 ? (
                <span className="t-meta">Unavailable all day</span>
              ) : (
                (hours[day] ?? []).map((range, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input
                      type="time"
                      sizeVariant="sm"
                      className="w-28"
                      value={minutesToHHMM(range.startMinute)}
                      onChange={(e) => setRange(day, i, { startMinute: hhmmToMinutes(e.target.value, range.startMinute) })}
                    />
                    <span className="text-xs text-ink-faint">to</span>
                    <Input
                      type="time"
                      sizeVariant="sm"
                      className="w-28"
                      value={minutesToHHMM(range.endMinute)}
                      onChange={(e) => setRange(day, i, { endMinute: hhmmToMinutes(e.target.value, range.endMinute) })}
                    />
                    <IconButton label="Remove range" size="xs" onClick={() => removeRange(day, i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                ))
              )}
              <Button size="xs" onClick={() => addRange(day)}>Add range</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-2">
        <div className="mb-1.5 text-sm font-medium text-ink">Preferred focus hours</div>
        <p className="t-meta mb-2">
          A scoring bonus, not a constraint: deep work is preferred here but will still be placed
          elsewhere when it has to be.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {focusHours.map((range, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                type="time"
                sizeVariant="sm"
                className="w-28"
                value={minutesToHHMM(range.startMinute)}
                onChange={(e) => {
                  const next = [...focusHours];
                  next[i] = { ...next[i]!, startMinute: hhmmToMinutes(e.target.value, range.startMinute) };
                  void onPatch({ focusHours: next });
                }}
              />
              <span className="text-xs text-ink-faint">to</span>
              <Input
                type="time"
                sizeVariant="sm"
                className="w-28"
                value={minutesToHHMM(range.endMinute)}
                onChange={(e) => {
                  const next = [...focusHours];
                  next[i] = { ...next[i]!, endMinute: hhmmToMinutes(e.target.value, range.endMinute) };
                  void onPatch({ focusHours: next });
                }}
              />
              <IconButton
                label="Remove focus range"
                size="xs"
                onClick={() => void onPatch({ focusHours: focusHours.filter((_, x) => x !== i) })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
          <Button
            size="xs"
            onClick={() =>
              void onPatch({ focusHours: [...focusHours, { startMinute: 9 * 60, endMinute: 12 * 60 }] })
            }
          >
            Add focus window
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Timers                                                              */
/* ------------------------------------------------------------------ */

export function TimerSettings({ settings, onPatch }: { settings: Settings; onPatch: Patch }) {
  const timers = { ...DEFAULT_TIMER_PREFERENCES, ...(settings.timers ?? {}) };
  const set = (patch: Partial<typeof timers>) => void onPatch({ timers: { ...timers, ...patch } });

  return (
    <SettingsSection
      title="Timers & Pomodoro"
      description="Defaults used by the Focus module when you start a session."
    >
      <SettingRow label="Default focus session">
        <Input
          type="number"
          min={5}
          max={240}
          value={timers.defaultFocusMinutes}
          onChange={(e) => set({ defaultFocusMinutes: clampNumber(e.target.value, 5, 240, 45) })}
        />
      </SettingRow>
      <SettingRow label="Pomodoro work interval">
        <Input
          type="number"
          min={5}
          max={90}
          value={timers.pomodoroWorkMinutes}
          onChange={(e) => set({ pomodoroWorkMinutes: clampNumber(e.target.value, 5, 90, 25) })}
        />
      </SettingRow>
      <SettingRow label="Short break">
        <Input
          type="number"
          min={1}
          max={30}
          value={timers.pomodoroShortBreakMinutes}
          onChange={(e) => set({ pomodoroShortBreakMinutes: clampNumber(e.target.value, 1, 30, 5) })}
        />
      </SettingRow>
      <SettingRow label="Long break">
        <Input
          type="number"
          min={5}
          max={60}
          value={timers.pomodoroLongBreakMinutes}
          onChange={(e) => set({ pomodoroLongBreakMinutes: clampNumber(e.target.value, 5, 60, 20) })}
        />
      </SettingRow>
      <SettingRow label="Pomodoros before a long break">
        <Input
          type="number"
          min={2}
          max={8}
          value={timers.pomodorosBeforeLongBreak}
          onChange={(e) => set({ pomodorosBeforeLongBreak: clampNumber(e.target.value, 2, 8, 4) })}
        />
      </SettingRow>
      <Toggle
        label="Start breaks automatically"
        description="When a work interval ends, roll straight into the break."
        checked={timers.autoStartBreaks}
        onChange={(v) => set({ autoStartBreaks: v })}
      />
    </SettingsSection>
  );
}
