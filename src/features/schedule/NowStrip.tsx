import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronRight, FileText, MoonStar, Play, SkipForward } from 'lucide-react';
import { BrandMark } from '@/components/layout/BrandMark';
import { useExamPlannerStore, useHasPaperSlots } from '@/features/practice/ExamPlannerSheet';
import { useCloseDayStore } from '@/features/review/CloseDaySheet';
import { useBlocksForDay, useLiveSettings, useNow, useTrackerMap } from '@/state/useLiveData';
import { requestCompleteBlock } from '@/state/completeBlockStore';
import { skipBlock, startBlock } from '@/services/scheduleService';
import { describePhase, phaseOn } from '@/engines/cycles';
import { db } from '@/db/db';
import { dateKeyToDate, formatTime, todayKey } from '@/lib/date';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';
import { trackerHex } from '@/features/schedule/dayRibbon';
import type { CycleDefinition, DateKey, RecurringRule } from '@/types';

/**
 * Weekdays a cycle is relevant on. Explicit `showOn` wins; otherwise it is
 * inferred from the recurring rules bound to the cycle — a cycle whose rules
 * only run on Sundays (e.g. "Test / Normal Sunday") only shows on Sundays.
 */
export function cycleWeekdays(cycle: CycleDefinition, rules: readonly RecurringRule[]): number[] | null {
  if (cycle.showOn) return cycle.showOn;
  const days = new Set<number>();
  for (const r of rules) {
    if (r.cyclePhase?.cycleId !== cycle.id || !r.active) continue;
    for (const d of r.byWeekday ?? []) days.add(d);
  }
  return days.size > 0 && days.size < 7 ? [...days].sort() : null;
}

/** "Prep Week · day 3 of 7" etc. for every active cycle relevant today. */
export function cycleLabels(
  cycles: readonly CycleDefinition[],
  date: DateKey,
  rules: readonly RecurringRule[] = [],
): string[] {
  const dow = dateKeyToDate(date).getDay();
  const out: string[] = [];
  for (const c of cycles) {
    if (!c.active) continue;
    const weekdays = cycleWeekdays(c, rules);
    if (weekdays && !weekdays.includes(dow)) continue;
    const hit = phaseOn(c, date);
    if (!hit) continue;
    // A weekday-only cycle reads as just its name ("Test Sunday").
    out.push(weekdays && weekdays.length === 1 ? hit.phase.title : describePhase(hit, date));
  }
  return out;
}

function minutesLeft(end: number, now: number): string {
  const m = Math.max(0, Math.ceil((end - now) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function MiniRing({ value, color, size = 16 }: { value: number; color: string; size?: number }) {
  const r = 6.5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeOpacity="0.28" strokeWidth="2.5" />
      <circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - value)} style={{ transition: 'stroke-dashoffset 900ms var(--ease-out)' }} />
    </svg>
  );
}

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const islandBtn = 'pressable inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors';

/**
 * The Notch — LifeOS's Dynamic Island. Always present at the top centre of
 * the stage. Collapsed it answers "what now?" in one line (area ring, block,
 * time left). Hover or tap and it morphs — width, height and corner radius
 * on the iOS sheet curve — into a live panel: the block, its progress,
 * Start / Done / Skip, what comes next, and the day's cycle phase.
 */
/** Widest the resting notch may be at a viewport width — the header sizes its side columns from this. */
export function notchRestMax(vw: number): number {
  if (vw < 520) return Math.max(120, vw - 236);
  if (vw < 900) return 230;
  if (vw < 1280) return 290;
  return 340;
}

export function Notch() {
  const today = todayKey();
  const now = useNow(30_000);
  const blocks = useBlocksForDay(today);
  const settings = useLiveSettings();
  const trackers = useTrackerMap();
  const rules = useLiveQuery(() => db.recurringRules.toArray(), []);
  const labels = useMemo(() => cycleLabels(settings?.cycles ?? [], today, rules ?? []), [settings?.cycles, today, rules]);
  const openCloseDay = useCloseDayStore((s) => s.open);
  const showPlanner = useExamPlannerStore((s) => s.show);
  const hasPaperSlots = useHasPaperSlots();

  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number>();
  const rootRef = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ cw: 180, ph: 200 });

  const live = blocks.filter((b) => b.status !== 'cancelled' && b.status !== 'skipped' && b.kind !== 'sleep');
  const current = live.filter((b) => b.start <= now && b.end > now && b.status !== 'completed').sort((a, b) => b.start - a.start)[0];
  const upcoming = live.filter((b) => b.start > now && b.status === 'planned').sort((a, b) => a.start - b.start).slice(0, 3);
  const next = upcoming[0];
  const reviewHour = settings?.notifications.dailyReviewHour ?? 21;
  const reviewDue = new Date(now).getHours() >= reviewHour && settings?.lastDailyReviewDate !== today;
  const progress = current ? Math.min(1, Math.max(0, (now - current.start) / (current.end - current.start))) : 0;
  const actionable = current !== undefined && !current.optional && !['break', 'meal', 'buffer'].includes(current.kind);
  const tracker = current ? trackers[current.trackerId] : undefined;
  const color = trackerHex(tracker?.color);
  const time = new Date(now).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  useLayoutEffect(() => {
    const measure = () => setDims({
      cw: (compactRef.current?.scrollWidth ?? 160) + 2,
      ph: panelRef.current?.scrollHeight ?? 200,
    });
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (compactRef.current) ro?.observe(compactRef.current);
    if (panelRef.current) ro?.observe(panelRef.current);
    return () => ro?.disconnect();
  }, [current?.id, current?.status, next?.id, labels.length, reviewDue, hasPaperSlots]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const panelW = typeof window !== 'undefined' ? Math.min(400, window.innerWidth - 24) : 400;
  const restMax = notchRestMax(typeof window !== 'undefined' ? window.innerWidth : 1440);
  const w = open ? panelW : Math.min(dims.cw, restMax);
  const h = open ? dims.ph : 40;

  return (
    <div
      ref={rootRef}
      className="island pointer-events-auto relative overflow-hidden"
      style={{
        width: w, height: h, borderRadius: open ? 30 : 20,
        transition: `width 520ms ${EASE}, height 520ms ${EASE}, border-radius 520ms ${EASE}`,
      }}
      onMouseEnter={() => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setOpen(true), 160); }}
      onMouseLeave={() => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setOpen(false), 280); }}
    >
      {/* Compact */}
      <div
        ref={compactRef}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={current ? `${current.title}, ${minutesLeft(current.end, now)} left. Show details` : 'Show today'}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
        className="absolute left-0 top-0 inline-flex h-10 cursor-pointer items-center gap-2.5 whitespace-nowrap pl-2.5 pr-4 focus-visible:outline-none"
        style={{ opacity: open ? 0 : 1, transform: open ? 'scale(0.92)' : 'none', transition: `opacity 200ms ease, transform 420ms ${EASE}`, pointerEvents: open ? 'none' : 'auto' }}
      >
        {current ? (
          <>
            <MiniRing value={progress} color={color} size={20} />
            <span className="max-w-[16rem] truncate text-[0.8125rem] font-semibold tracking-[-0.01em]">{current.title}</span>
            <span className="t-num text-[0.8125rem] font-semibold" style={{ color }}>{minutesLeft(current.end, now)}</span>
          </>
        ) : (
          <>
            <BrandMark className="h-5 w-5 [&_rect]:fill-transparent" />
            <span className="t-num text-[0.8125rem] font-semibold">{time}</span>
            {labels[0] ? <span className="text-[0.8125rem] font-semibold text-[rgb(255_214_10)]">{labels[0]}</span> : null}
            {next ? <span className="max-w-[14rem] truncate text-[0.8125rem] text-white/60">Next {formatTime(next.start)} · {next.title}</span> : null}
          </>
        )}
        {reviewDue ? <span className="h-2 w-2 rounded-full bg-accent" aria-label="Close the day is due" /> : null}
      </div>

      {/* Expanded panel */}
      <div
        ref={panelRef}
        className="absolute left-0 top-0 w-full p-5"
        style={{ width: panelW, opacity: open ? 1 : 0, transform: open ? 'none' : 'scale(0.96) translateY(-6px)', transition: `opacity 260ms ease ${open ? '120ms' : '0ms'}, transform 520ms ${EASE}`, pointerEvents: open ? 'auto' : 'none' }}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[0.75rem] font-semibold text-white/60">
            <BrandMark className="h-5 w-5 [&_rect]:fill-transparent" />
            <span className="t-num">{time}</span>
            {labels.map((l) => <span key={l} className="truncate text-[rgb(255_214_10)]">· {l}</span>)}
          </div>
          <Link to="/schedule" onClick={() => setOpen(false)} className="inline-flex shrink-0 items-center text-[0.75rem] font-semibold text-white/60 hover:text-white">
            Schedule <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {current ? (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-[0.75rem] font-semibold" style={{ color }}>
              <span className="live-dot h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {tracker?.name ?? 'Now'}{current.status === 'in_progress' ? ' · logging' : ''}
            </div>
            <div className="mt-1.5 flex items-end justify-between gap-3">
              <div className="min-w-0 text-[1.375rem] font-bold leading-tight tracking-[-0.02em]">{current.title}</div>
              <div className="t-rounded t-num shrink-0 text-[1.75rem] font-semibold leading-none" style={{ color }}>{minutesLeft(current.end, now)}</div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${progress * 100}%`, backgroundColor: color }} />
            </div>
            <div className="t-num mt-1.5 flex justify-between text-[0.6875rem] text-white/50">
              <span>{formatTime(current.start)}</span><span>{formatTime(current.end)}</span>
            </div>
            {actionable ? (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {current.status === 'planned' ? (
                  <button type="button" className={cn(islandBtn, 'bg-white/15 hover:bg-white/25')}
                    onClick={async () => { await startBlock(current.id); toast.success('Started', `${current.title} logs itself when it ends.`); }}>
                    <Play className="h-3.5 w-3.5 fill-current" /> Start
                  </button>
                ) : <span className={cn(islandBtn, 'bg-white/5 text-white/50')}>Running</span>}
                <button type="button" className={cn(islandBtn, 'bg-[rgb(48_209_88)] text-black hover:brightness-110')}
                  onClick={() => { setOpen(false); void requestCompleteBlock(current); }}>
                  <Check className="h-4 w-4" strokeWidth={3} /> Done
                </button>
                <button type="button" className={cn(islandBtn, 'bg-white/10 text-white/80 hover:bg-white/20')}
                  onClick={async () => { await skipBlock(current.id); toast.show('Skipped', current.title); }}>
                  <SkipForward className="h-3.5 w-3.5" /> Skip
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 text-[1.0625rem] font-semibold">{next ? 'Free right now' : 'Nothing else scheduled today'}</div>
        )}

        {upcoming.length ? (
          <ul className="mt-5 space-y-1 border-t border-white/10 pt-4">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center gap-3 text-[0.8125rem]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: trackerHex(trackers[b.trackerId]?.color) }} />
                <span className="t-num w-16 shrink-0 text-white/50">{formatTime(b.start)}</span>
                <span className="min-w-0 truncate text-white/90">{b.title}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {(reviewDue || hasPaperSlots) ? (
          <div className="mt-4 flex gap-2">
            {reviewDue ? (
              <button type="button" onClick={() => { setOpen(false); openCloseDay(today); }} className={cn(islandBtn, 'flex-1 bg-accent text-accent-contrast hover:brightness-110')}>
                <MoonStar className="h-3.5 w-3.5" /> Close the day
              </button>
            ) : null}
            {hasPaperSlots ? (
              <button type="button" onClick={() => { setOpen(false); showPlanner(); }} className={cn(islandBtn, 'flex-1 bg-white/10 hover:bg-white/20')}>
                <FileText className="h-3.5 w-3.5" /> Plan papers
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Back-compat alias: older imports render the notch. */
export const NowStrip = Notch;
