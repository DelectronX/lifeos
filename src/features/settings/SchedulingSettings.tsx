import { useMemo } from 'react';
import { Lock, Shield, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Select, Toggle } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/state/toastStore';
import { formatDuration, formatTime, relativeDayLabel } from '@/lib/date';
import { setBlockLocked, setBlockProtected, deleteBlock } from '@/services/scheduleService';
import { SettingRow, SettingsSection, clampNumber } from './SettingsSection';
import { readAutoReschedulePreferences } from '@/state/autoRescheduleStore';
import type { AutoRescheduleMode, DeepPartial, RescheduleStrategy, SchedulingConfig, Settings } from '@/types';

export type ConfigPatch = (patch: DeepPartial<SchedulingConfig>) => void | Promise<void>;

const STRATEGY_LABELS: Record<RescheduleStrategy, string> = {
  next_slot: 'Next free slot',
  tomorrow: 'Tomorrow',
  split: 'Split into sessions',
  displace: 'Displace a lower-priority task',
  shrink: 'Shorten the session',
  cancel: 'Cancel',
  manual: 'Ask me',
};

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

export function SchedulingSettings({
  config, onPatch,
}: {
  config: SchedulingConfig;
  onPatch: ConfigPatch;
}) {
  return (
    <SettingsSection
      title="Scheduling"
      description="How the scheduling engine places work. Every number here feeds the engines directly."
    >
      <SettingRow label="Default session length" hint="Used when a task has no explicit estimate shape.">
        <Input
          type="number" min={5} max={240}
          value={config.slots.defaultSessionMinutes}
          onChange={(e) => void onPatch({ slots: { defaultSessionMinutes: clampNumber(e.target.value, 5, 240, 45) } })}
        />
      </SettingRow>
      <SettingRow label="Minimum session" hint="Gaps shorter than this are never offered.">
        <Input
          type="number" min={5} max={120}
          value={config.slots.minSessionMinutes}
          onChange={(e) => void onPatch({ slots: { minSessionMinutes: clampNumber(e.target.value, 5, 120, 20) } })}
        />
      </SettingRow>
      <SettingRow label="Maximum session" hint="A longer task is split into several sittings.">
        <Input
          type="number" min={15} max={480}
          value={config.slots.maxSessionMinutes}
          onChange={(e) => void onPatch({ slots: { maxSessionMinutes: clampNumber(e.target.value, 15, 480, 120) } })}
        />
      </SettingRow>
      <SettingRow label="Buffer between blocks">
        <Input
          type="number" min={0} max={60}
          value={config.slots.bufferMinutes}
          onChange={(e) => void onPatch({ slots: { bufferMinutes: clampNumber(e.target.value, 0, 60, 0) } })}
        />
      </SettingRow>
      <SettingRow label="Daily load ceiling" hint="Total scheduled work minutes allowed on one day.">
        <Input
          type="number" min={60} max={960}
          value={config.slots.maxDailyLoadMinutes}
          onChange={(e) => void onPatch({ slots: { maxDailyLoadMinutes: clampNumber(e.target.value, 60, 960, 480) } })}
        />
      </SettingRow>
      <SettingRow label="Planning horizon (days)" hint="How far ahead auto-plan may look.">
        <Input
          type="number" min={1} max={90}
          value={config.slots.horizonDays}
          onChange={(e) => void onPatch({ slots: { horizonDays: clampNumber(e.target.value, 1, 90, 14) } })}
        />
      </SettingRow>
      <SettingRow label="Snap grid (minutes)">
        <Select
          value={String(config.slots.granularityMinutes)}
          onChange={(e) => void onPatch({ slots: { granularityMinutes: Number(e.target.value) } })}
        >
          {[5, 10, 15, 30].map((n) => <option key={n} value={n}>{n} min</option>)}
        </Select>
      </SettingRow>

      <div className="pt-2">
        <div className="mb-1.5 text-sm font-medium text-ink">Breaks</div>
        <div className="space-y-3">
          <Toggle
            label="Enforce breaks after intensive work"
            description={`A break is inserted after ${config.breaks.intensiveThresholdMinutes} min of continuous high-intensity work.`}
            checked={config.breaks.enforceBetweenIntensive}
            onChange={(v) => void onPatch({ breaks: { enforceBetweenIntensive: v } })}
          />
          <SettingRow label="Intensive threshold">
            <Input
              type="number" min={15} max={180}
              value={config.breaks.intensiveThresholdMinutes}
              onChange={(e) => void onPatch({ breaks: { intensiveThresholdMinutes: clampNumber(e.target.value, 15, 180, 60) } })}
            />
          </SettingRow>
          <SettingRow label="Break length">
            <Input
              type="number" min={1} max={60}
              value={config.breaks.breakMinutes}
              onChange={(e) => void onPatch({ breaks: { breakMinutes: clampNumber(e.target.value, 1, 60, 10) } })}
            />
          </SettingRow>
          <SettingRow label="Long break length">
            <Input
              type="number" min={5} max={90}
              value={config.breaks.longBreakMinutes}
              onChange={(e) => void onPatch({ breaks: { longBreakMinutes: clampNumber(e.target.value, 5, 90, 25) } })}
            />
          </SettingRow>
        </div>
      </div>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Rescheduling                                                        */
/* ------------------------------------------------------------------ */

export function ReschedulingSettings({
  config, onPatch,
}: {
  config: SchedulingConfig;
  onPatch: ConfigPatch;
}) {
  const order = config.rescheduling.strategyOrder;

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    void onPatch({ rescheduling: { strategyOrder: next } });
  };

  return (
    <SettingsSection
      title="Rescheduling"
      description="What happens to work that did not get done. Auto mode still shows you a preview before anything moves."
    >
      <Toggle
        label="Offer full-auto rescheduling"
        description="Adds a one-click 'reschedule everything that slipped' action. It always previews first — nothing moves silently."
        checked={config.rescheduling.autoReschedule}
        onChange={(v) => void onPatch({ rescheduling: { autoReschedule: v } })}
      />

      <SettingRow label="Overrun tolerance" hint="Overrunning by less than this raises no conflict.">
        <Input
          type="number" min={0} max={60}
          value={config.rescheduling.overrunToleranceMinutes}
          onChange={(e) => void onPatch({ rescheduling: { overrunToleranceMinutes: clampNumber(e.target.value, 0, 60, 5) } })}
        />
      </SettingRow>
      <SettingRow
        label="Maximum automatic moves"
        hint="After this many auto-moves a task is handed back to you — repeated slippage is a signal, not a scheduling problem."
      >
        <Input
          type="number" min={1} max={10}
          value={config.rescheduling.maxAutoMoves}
          onChange={(e) => void onPatch({ rescheduling: { maxAutoMoves: clampNumber(e.target.value, 1, 10, 3) } })}
        />
      </SettingRow>
      <SettingRow
        label="Displacement priority margin"
        hint="A task is only pushed aside if it scores at least this far below the mover."
      >
        <Input
          type="number" min={0} max={50}
          value={config.rescheduling.displacementPriorityMargin}
          onChange={(e) => void onPatch({ rescheduling: { displacementPriorityMargin: clampNumber(e.target.value, 0, 50, 12) } })}
        />
      </SettingRow>

      <div className="pt-2">
        <div className="mb-1.5 text-sm font-medium text-ink">Strategy preference order</div>
        <p className="t-meta mb-2">Auto mode tries these in order and recommends the first that fits.</p>
        <ul className="space-y-1">
          {order.map((strategy, i) => (
            <li key={strategy} className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
              <span className="t-num w-5 text-xs text-ink-faint">{i + 1}</span>
              <span className="flex-1 text-sm text-ink">{STRATEGY_LABELS[strategy]}</span>
              <Button size="xs" disabled={i === 0} onClick={() => move(i, -1)}>Up</Button>
              <Button size="xs" disabled={i === order.length - 1} onClick={() => move(i, 1)}>Down</Button>
            </li>
          ))}
        </ul>
      </div>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Auto-reschedule mode                                                */
/* ------------------------------------------------------------------ */

const MODE_LABELS: Record<AutoRescheduleMode, string> = {
  off: 'Off',
  suggest: 'Suggest — always ask first',
  automatic: 'Automatic — apply, then explain',
};

const MODE_HINTS: Record<AutoRescheduleMode, string> = {
  off: 'Nothing runs automatically. Use the manual "Review slipped tasks" action any time.',
  suggest: 'On app start, slipped tasks are found and a preview is shown for you to accept, edit, or dismiss. Nothing moves until you say so.',
  automatic: 'Slipped tasks are rescheduled immediately as one undoable change, then a notice explains exactly what moved and why — with a one-click Undo.',
};

export function AutoRescheduleModeSettings({
  settings, onPatch,
}: {
  settings: Settings;
  onPatch: (patch: Partial<Omit<Settings, 'id'>>) => void | Promise<void>;
}) {
  const prefs = readAutoReschedulePreferences(settings);

  const setMode = (mode: AutoRescheduleMode) => void onPatch({ autoReschedule: { ...prefs, mode } });

  return (
    <SettingsSection
      title="Auto-reschedule"
      description="What happens to work that slipped — was skipped, ran over, or is overdue. See SPEC §40: nothing may move invisibly."
    >
      <div className="space-y-1.5">
        {(['off', 'suggest', 'automatic'] as const).map((mode) => (
          <label
            key={mode}
            className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 has-[:checked]:border-accent/50 has-[:checked]:bg-accent/5"
          >
            <input
              type="radio"
              name="auto-reschedule-mode"
              className="mt-1"
              checked={prefs.mode === mode}
              onChange={() => setMode(mode)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{MODE_LABELS[mode]}</span>
              <span className="t-meta mt-0.5 block">{MODE_HINTS[mode]}</span>
            </span>
          </label>
        ))}
      </div>

      {prefs.mode !== 'off' ? (
        <Toggle
          label="Also check while the app is open"
          description="Not just at startup — re-check on an interval so a task that slips mid-session is caught the same day."
          checked={prefs.runWhileOpen}
          onChange={(v) => void onPatch({ autoReschedule: { ...prefs, runWhileOpen: v } })}
        />
      ) : null}
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Protected blocks                                                    */
/* ------------------------------------------------------------------ */

/**
 * Lists every protected/locked block in the near future, so "what time is
 * ring-fenced" is answerable in one place rather than by scrolling the
 * calendar. Every control here writes through scheduleService.
 */
export function ProtectedTimeSettings() {
  const blocks = useLiveQuery(
    () => db.blocks
      .where('date')
      .aboveOrEqual(new Date().toISOString().slice(0, 10))
      .filter((b) => (b.protected || b.locked) && b.status !== 'cancelled')
      .limit(200)
      .toArray(),
    [],
  ) ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, typeof blocks>();
    for (const b of [...blocks].sort((a, b) => a.start - b.start)) {
      const list = map.get(b.date) ?? [];
      list.push(b);
      map.set(b.date, list);
    }
    return [...map.entries()].slice(0, 14);
  }, [blocks]);

  return (
    <SettingsSection
      title="Protected time"
      description="Blocks the scheduler is never allowed to write over. Protected means sleep/school/meals; locked means you pinned it."
    >
      {grouped.length === 0 ? (
        <p className="t-meta">
          Nothing is protected in the next two weeks. Mark a block protected from the schedule
          inspector, or apply a schedule template that includes sleep and meals.
        </p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {grouped.map(([date, dayBlocks]) => (
            <div key={date}>
              <div className="t-label mb-1">{relativeDayLabel(date)}</div>
              <ul className="space-y-1">
                {dayBlocks.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">{b.title}</div>
                      <span className="t-num text-2xs text-ink-muted">
                        {formatTime(b.start)}–{formatTime(b.end)} · {formatDuration((b.end - b.start) / 60000)}
                      </span>
                    </div>
                    <Badge tone={b.protected ? 'accent' : 'neutral'}>
                      {b.protected ? <Shield className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                      {b.protected ? 'Protected' : 'Locked'}
                    </Badge>
                    <Button
                      size="xs"
                      onClick={async () => {
                        await setBlockProtected(b.id, !b.protected);
                        toast.success(b.protected ? 'Protection removed' : 'Block protected');
                      }}
                    >
                      {b.protected ? 'Unprotect' : 'Protect'}
                    </Button>
                    <Button
                      size="xs"
                      onClick={async () => {
                        await setBlockLocked(b.id, !b.locked);
                        toast.success(b.locked ? 'Unlocked' : 'Locked');
                      }}
                    >
                      {b.locked ? 'Unlock' : 'Lock'}
                    </Button>
                    <IconButton
                      label="Delete block"
                      size="xs"
                      onClick={async () => { await deleteBlock(b.id); toast.success('Block deleted'); }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-critical" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Revision                                                            */
/* ------------------------------------------------------------------ */

export function RevisionSettings({
  config, onPatch,
}: {
  config: SchedulingConfig;
  onPatch: ConfigPatch;
}) {
  const intervals = config.revision.intervals;

  return (
    <SettingsSection
      title="Revision"
      description="Spaced-repetition defaults. Existing plans keep the ladder they were created with; changes here apply to new plans."
    >
      <div>
        <div className="mb-1.5 text-sm font-medium text-ink">Interval ladder (days)</div>
        <p className="t-meta mb-2">Days after the previous repetition that the next one is due.</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {intervals.map((days, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                type="number"
                sizeVariant="sm"
                className="w-20"
                min={1}
                max={720}
                value={days}
                onChange={(e) => {
                  const next = [...intervals];
                  next[i] = clampNumber(e.target.value, 1, 720, days);
                  void onPatch({ revision: { intervals: next } });
                }}
              />
              <IconButton
                label="Remove interval"
                size="xs"
                onClick={() => void onPatch({ revision: { intervals: intervals.filter((_, x) => x !== i) } })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
          <Button
            size="xs"
            onClick={() =>
              void onPatch({
                revision: { intervals: [...intervals, (intervals[intervals.length - 1] ?? 1) * 2] },
              })
            }
          >
            Add step
          </Button>
        </div>
      </div>

      <SettingRow label="Default revision length">
        <Input
          type="number" min={5} max={180}
          value={config.revision.defaultDurationMinutes}
          onChange={(e) => void onPatch({ revision: { defaultDurationMinutes: clampNumber(e.target.value, 5, 180, 25) } })}
        />
      </SettingRow>
      <SettingRow label="Mark missed after (days)">
        <Input
          type="number" min={0} max={30}
          value={config.revision.missedAfterDays}
          onChange={(e) => void onPatch({ revision: { missedAfterDays: clampNumber(e.target.value, 0, 30, 1) } })}
        />
      </SettingRow>
      <SettingRow label="Starting ease" hint="SM-2 ease factor for new plans (1.3 – 3.0).">
        <Input
          type="number" step="0.1" min={1.3} max={3}
          value={config.revision.initialEase}
          onChange={(e) => {
            const n = Number(e.target.value);
            void onPatch({ revision: { initialEase: Number.isFinite(n) ? Math.min(3, Math.max(1.3, n)) : 2.5 } });
          }}
        />
      </SettingRow>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* XP                                                                  */
/* ------------------------------------------------------------------ */

const XP_EVENT_LABELS: Record<string, string> = {
  task_completed: 'Task completed',
  block_completed: 'Schedule block completed',
  timer_session: 'Timer session',
  pomodoro_completed: 'Pomodoro completed',
  paper_submitted: 'Paper submitted',
  revision_completed: 'Revision completed',
  habit_checkin: 'Habit check-in',
  milestone_completed: 'Milestone completed',
  goal_completed: 'Goal completed',
  daily_review: 'Daily review',
  weekly_review: 'Weekly review',
};

export function XPSettings({
  config, onPatch,
}: {
  config: SchedulingConfig;
  onPatch: ConfigPatch;
}) {
  const xp = config.xp;

  return (
    <SettingsSection
      title="XP & levels"
      description="Award values and anti-farming limits. Daily caps exist so repeating a cheap action cannot inflate progress."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(XP_EVENT_LABELS).map(([key, label]) => (
          <SettingRow key={key} label={label} className="sm:gap-2">
            <Input
              type="number" min={0} max={1000} sizeVariant="sm"
              value={xp.awards[key] ?? 0}
              onChange={(e) =>
                void onPatch({ xp: { awards: { ...xp.awards, [key]: clampNumber(e.target.value, 0, 1000, 0) } } })
              }
            />
          </SettingRow>
        ))}
      </div>

      <SettingRow label="XP per focused minute">
        <Input
          type="number" step="0.1" min={0} max={10}
          value={xp.perFocusMinute}
          onChange={(e) => {
            const n = Number(e.target.value);
            void onPatch({ xp: { perFocusMinute: Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 0.6 } });
          }}
        />
      </SettingRow>
      <SettingRow label="Daily XP ceiling" hint="Nothing earns XP past this in one day.">
        <Input
          type="number" min={100} max={10000}
          value={xp.dailyTotalCap}
          onChange={(e) => void onPatch({ xp: { dailyTotalCap: clampNumber(e.target.value, 100, 10000, 1200) } })}
        />
      </SettingRow>
      <SettingRow label="Level curve base" hint="XP needed for level 2; later levels scale by the exponent.">
        <Input
          type="number" min={50} max={2000}
          value={xp.levelCurve.base}
          onChange={(e) => void onPatch({ xp: { levelCurve: { ...xp.levelCurve, base: clampNumber(e.target.value, 50, 2000, 220) } } })}
        />
      </SettingRow>
      <SettingRow label="Level curve exponent">
        <Input
          type="number" step="0.05" min={1} max={3}
          value={xp.levelCurve.exponent}
          onChange={(e) => {
            const n = Number(e.target.value);
            void onPatch({ xp: { levelCurve: { ...xp.levelCurve, exponent: Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : 1.45 } } });
          }}
        />
      </SettingRow>
      <SettingRow
        label="Minimum task age for XP (seconds)"
        hint="Blocks create-then-complete farming loops."
      >
        <Input
          type="number" min={0} max={600}
          value={xp.minTaskAgeSeconds}
          onChange={(e) => void onPatch({ xp: { minTaskAgeSeconds: clampNumber(e.target.value, 0, 600, 45) } })}
        />
      </SettingRow>
    </SettingsSection>
  );
}
