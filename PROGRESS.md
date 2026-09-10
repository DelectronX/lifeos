# LifeOS build progress

Accurate status as of the Daily/Weekly Review milestone. See `SPEC.md` for the
full specification and `README.md` for architecture and setup.

**Current state:** `npx tsc --noEmit` clean, `npx vitest run` green (237 engine
tests across 9 files). `npm run build` is green for everything in this report.

---

## Phase 1 — complete

Vite + React 18 + TS (strict) scaffold; Tailwind design system with light/dark
CSS token themes; full Dexie schema for all entities with compound indexes tuned
for the hot query paths; universal Activity log and single write path
(`activityService`); central `schedulingConfig.ts`; XP/level engine; app shell
with desktop sidebar and mobile tab bar; react-router routes for every module;
base components (Button, Card, Badge, Input/Select/Textarea/Toggle, Modal, Tabs,
Progress, Toaster, Menu); live-query hooks layer; tracker CRUD page.

## Phase 2 — complete

Tasks CRUD with the full field set and status history (Inbox / Planned /
In Progress / Completed / Skipped / Rescheduled / Cancelled), filtering, bulk
edits and direct scheduling. Schedule module with day/week timeline and agenda
views, block create/inspect, drag/resize/move/duplicate/split/delete/lock/
protect, task↔block conversion, recurring rules and schedule templates. Goals →
Milestones → Tasks hierarchy with automatic progress via `goalProgress.ts`.

Note: timeline drag/resize is hand-rolled on pointer events
(`features/schedule/useTimelineDrag.ts`) rather than `@dnd-kit`, which is still
listed in `package.json` but unused.

## Phase 3 — complete

`schedulingConfig.ts` plus PriorityScoring, Scheduling, Rescheduling,
ConflictResolution and DurationPrediction engines, all pure and unit-tested.
Wired into the Schedule UI through `planService`: auto-plan with a before/after
impact preview and per-proposal selection, per-task reschedule dialog with every
costed option and its explanation, conflict dialog, overload banner, duration
hints, and undo for every automated change via `PlanRun` before/after snapshots.

Partial: `autoReschedule` and `previewAutoReschedule`/`applyAutoReschedule` exist
and are tested in the engine and service layers, but the full-auto ("reschedule
everything that slipped, unattended") mode has **no UI entry point** yet — all
rescheduling in the app today is user-confirmed, one task at a time.

## Phase 4 — complete

Focus module with Focus, Pomodoro, Stopwatch and Countdown timers, an active
timer panel and session history. Every run writes a persistent `TimerSession`
plus an Activity record tied to the task/goal/tracker, so tracked time is
measured rather than typed in. Timer core logic is unit-tested (13 tests).

## Phase 5 — complete

Paper Mode: multi-subject mock test builder, per-question timer with automatic
time capture on navigation, per-question status (Correct / Incorrect / Skipped /
Marked), mistake classification across the eight specified categories, question
palette, paper review screen and `paperAnalytics.ts` (26 tests).

## Phase 6 — complete

Revision engine (`revisionScheduling.ts`, 24 tests) with configurable
spaced-repetition intervals, manual overrides and missed-revision handling
through the rescheduling engine; Revision dashboard with Due Today / Tomorrow /
Upcoming / Overdue / Recently Completed. XP engine, level curve and
automatically-derived achievements with anti-farming safeguards.

**Daily Review** (`features/review/DailyReviewPage.tsx` + `DailyRecap`,
`TaskTriageCard`, `DailySummary`, `ReviewParts`) — a three-step guided close-out
rather than a dashboard:

1. Recap: completed vs still-open tasks, time tracked vs planned, block
   completion and skips, tracker breakdown, goals that gained time, XP earned.
2. Triage: every incomplete task in sequence. For each one the
   ReschedulingEngine's costed options are offered — move to tomorrow, find the
   next available slot, split into sessions, schedule manually, cancel — with
   the engine's own explanation shown, a before/after schedule preview via the
   existing `ImpactPreview`, and a link to the complete option list in the
   existing `PlanRescheduleDialog`. Nothing is written until confirmed.
3. Summary: exactly what was rescheduled and where it landed, with per-change
   undo, plus counts of what was cancelled or left open.

Day navigation moves through history; an empty day is stated plainly rather than
rendered as a wall of zeros.

**Weekly Review** (`features/review/WeeklyReviewPage.tsx`) — tasks completed
with the trend against the previous week, time by pillar and by tracker, a
day-by-day series that marks inactive days as inactive, planned vs actual,
questions completed with the accuracy change vs the previous week, revision
completion rate, and goal progress. The "most time recorded" and "furthest below
target" verdicts come straight from `computeWeeklyReview` and are always printed
next to the numbers they were derived from. Week navigation respects the
configured week start day.

Both review pages compute nothing themselves: all figures come from
`computeDailyReview` / `computeWeeklyReview` in `engines/analytics.ts` via
`analyticsService`, and all schedule changes go through `planService`.

## Phase 7 — complete

Analytics sections (Overview, Study, Fitness, Skills, Personal, Time, Goals)
computed from real Activity / Task / TimerSession / QuestionAttempt records by
`engines/analytics.ts` (67 tests). No hardcoded numbers. Charts are small
hand-written SVG components in `src/components/charts/` rather than `recharts`,
which remains an unused dependency.

## Phase 8 — mostly complete

Done: PWA/service worker via `vite-plugin-pwa` with Workbox precaching and
navigation fallback; JSON export/import with schema validation, versioned
migrations (`migrationService`) and automatic local snapshots
(`backupService`); Dexie schema at version 3 with forward migrations;
virtualised resource library via `react-window`; Settings page wiring theme,
week start, durations, Pomodoro, revision intervals, XP, notifications,
scheduling preferences, working/focus hours, protected blocks and the storage
report; startup maintenance hook (`runStartupMaintenance`); Vitest suites for
every engine; this README.

## What remains

- **Full-auto rescheduling has no UI.** The engine and service functions exist
  and are tested; nothing calls them from a screen.
- **No component or service tests.** All 237 tests are pure-engine tests. The
  services (`planService`, `taskService`, `analyticsService`, …) and every React
  component are untested; `fake-indexeddb` is installed for this but unused.
- **Analytics snapshot rollups are not scheduled.** `rollSnapshots` and
  `writeSnapshot` in `analyticsService` are implemented but never invoked, so
  long-range analytics always replay the event log.
- **Notification scheduling is settings-only.** `notificationService` is wired
  into Settings for permission and preferences; no screen actually schedules the
  upcoming-block / revision-due / daily-review reminders it supports.
- **Unused dependencies.** `@dnd-kit/*` and `recharts` can be dropped from
  `package.json`.
- **No accessibility pass** (focus management in modals, keyboard navigation of
  the timeline, ARIA on the custom charts) and no automated a11y checks.
- Daily Review's manual-scheduling path reads the task's blocks back from Dexie
  to report what happened, because `ScheduleTaskModal` does not report its
  result to the caller; a return value on that modal would be cleaner.
