import { useCallback, useMemo, useState } from 'react';
import { addDaysToKey, dateKeyRange, formatDateKeyShort, startOfWeekKey, todayKey } from '@/lib/date';
import type { DateKey } from '@/types';

/**
 * The analytics range selector's state.
 *
 * This is presentation state only: it resolves a preset into the `from`/`to`
 * pair the pure engine already expects. No aggregation happens here.
 */

export type RangePreset = 'week' | 'lastWeek' | 'month' | '30d' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'lastWeek', label: 'Last week' },
  { value: 'month', label: 'This month' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
];

export interface ResolvedAnalyticsRange {
  preset: RangePreset;
  from: DateKey;
  to: DateKey;
  label: string;
  /** Inclusive day count of the window. */
  days: number;
}

export function resolvePreset(
  preset: Exclude<RangePreset, 'custom'>,
  today: DateKey,
  weekStartsOn: 0 | 1,
): { from: DateKey; to: DateKey } {
  switch (preset) {
    case 'week':
      return { from: startOfWeekKey(today, weekStartsOn), to: today };
    case 'lastWeek': {
      const thisWeek = startOfWeekKey(today, weekStartsOn);
      const from = addDaysToKey(thisWeek, -7);
      return { from, to: addDaysToKey(from, 6) };
    }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case '30d':
      return { from: addDaysToKey(today, -29), to: today };
  }
}

export interface RangeController extends ResolvedAnalyticsRange {
  setPreset: (preset: RangePreset) => void;
  setCustom: (from: DateKey, to: DateKey) => void;
  customFrom: DateKey;
  customTo: DateKey;
}

export function useAnalyticsRangeSelector(weekStartsOn: 0 | 1 = 1): RangeController {
  const today = todayKey();
  const [preset, setPresetState] = useState<RangePreset>('week');
  const [customFrom, setCustomFrom] = useState<DateKey>(() => addDaysToKey(today, -13));
  const [customTo, setCustomTo] = useState<DateKey>(today);

  const setCustom = useCallback((from: DateKey, to: DateKey) => {
    // Guard against an inverted range: swap rather than silently show nothing.
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    setCustomFrom(lo);
    setCustomTo(hi);
    setPresetState('custom');
  }, []);

  return useMemo(() => {
    const { from, to } =
      preset === 'custom' ? { from: customFrom, to: customTo } : resolvePreset(preset, today, weekStartsOn);
    const label =
      preset === 'custom'
        ? `${formatDateKeyShort(from)} – ${formatDateKeyShort(to)}`
        : RANGE_PRESETS.find((p) => p.value === preset)!.label;
    return {
      preset,
      from,
      to,
      label,
      days: dateKeyRange(from, to).length,
      setPreset: setPresetState,
      setCustom,
      customFrom,
      customTo,
    };
  }, [preset, customFrom, customTo, today, weekStartsOn, setCustom]);
}
