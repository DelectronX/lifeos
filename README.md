# LifeOS

An offline-first personal operating system for study, fitness, skills and personal
life. Not a to-do list bolted to a calendar: tasks, schedule blocks, timers, papers,
revisions, goals and XP all reference **one universal Activity record**, so every
number the app shows can be traced back to something that actually happened.

Everything runs in your browser. There is no account, no server, no sync and no
external API — install the dependencies once and the app works with the network
switched off, permanently.

---

## Setup and run

Requires Node 18+ (Node 20+ recommended) and npm.

```bash
npm install      # install dependencies (the only step that needs a network)
npm run dev      # dev server with hot reload → http://localhost:5173
npm run build    # type-check (tsc -b) + production build into dist/
npm run preview  # serve the production build locally
npx vitest run   # run the engine unit tests once (npm test does the same)
npm run test:watch  # tests in watch mode
```

`npm run build` runs `tsc -b` first, so a type error fails the build rather than
shipping. `npx tsc --noEmit` type-checks without building.

---

## Architecture

Three layers, deliberately separated:

```
src/engines/    pure functions — no React, no Dexie, no I/O, fully unit-tested
src/services/   Dexie reads/writes + React live-query hooks; wires engines to storage
src/features/   screens and components; formats what the engines produced
```

The rule the codebase holds to: **engines decide, services persist, features
display.** A component never computes an aggregate or a schedule placement itself.

### Engines (`src/engines/`)

| Engine | File | Responsibility |
| --- | --- | --- |
| Priority scoring | `priorityScoring.ts` | Transparent 0–100 score from basePriority, deadline urgency, goal weight, overdue penalty, dependency and revision weight |
| Scheduling | `scheduling.ts` | Places tasks into free slots respecting protected/locked blocks, working and focus hours, deadlines, splitting and dependencies |
| Rescheduling | `rescheduling.ts` | `computeRemainingWork`, `buildRescheduleOptions`, `autoReschedule`, `detectOverload`. Each option carries its own human-readable explanation |
| Conflict resolution | `conflictResolution.ts` | Overruns: what downstream blocks shift, shrink, move or drop, and why |
| Duration prediction | `durationPrediction.ts` | Estimated vs actual history per task type/subject; advisory only, never auto-applied |
| Revision scheduling | `revisionScheduling.ts` | Spaced-repetition intervals, manual overrides, missed-revision handling |
| Goal progress | `goalProgress.ts` | Progress and pace for completion / metric / time / habit goals |
| Analytics | `analytics.ts` | Every aggregate in the app, including `computeDailyReview` and `computeWeeklyReview` |
| Paper analytics | `paperAnalytics.ts` | Accuracy, per-question timing, mistake classification |
| XP | `xp.ts` | XP awards, level curve, anti-farming safeguards |

All engines are deterministic and configured from `src/config/schedulingConfig.ts`.
No AI, no randomness, no network calls. They are tested in
`src/engines/__tests__/` (**237 tests** across 9 files: scheduling 29,
rescheduling 27, analytics 67, paper analytics 26, revision 24, duration
prediction 20, conflict resolution 19, timer core 13, priority scoring 12).

### Services (`src/services/`)

Data access plus the small amount of orchestration that needs storage:

- `planService.ts` — the apply/undo layer for engine proposals. Every automated
  change is written inside one Dexie transaction together with a `PlanRun`
  record holding before/after snapshots, which is what makes **undo** work for
  auto-plan, reschedule and conflict resolution alike.
- `analyticsService.ts` — loads the records the AnalyticsEngine needs and hands
  them over. It performs no aggregation itself.
- `taskService`, `scheduleService`, `goalService`, `timerService`,
  `paperService`, `revisionService`, `habitService`, `resourceService`,
  `xpService`, `achievementService`, `notificationService`,
  `recurrenceService`, `templateService`, `settingsService`,
  `backupService`, `migrationService`, `maintenanceService`.
- `activityService.ts` — the single write path for the universal Activity log.

### The universal Activity model

`Activity` is one row per real thing that happened: a task completed, a block
completed or skipped, a timer session, a paper submitted, a question attempted,
a revision completed or missed, a habit check-in, a level-up, a review.

Each row carries `at`, `date`, `type`, `durationMs` and the ids it relates to
(`taskId`, `blockId`, `sessionId`, `trackerId`, `goalId`, …). Because analytics,
XP, goal progress, streaks and both review flows all read from this one table,
the four pillars are views over shared data rather than four parallel systems.

### Dexie schema

IndexedDB via Dexie 4, currently at **schema version 3** (`src/db/db.ts`), with
versioned upgrades so existing databases migrate forward rather than reset.

Tables: `profile`, `settings`, `trackers`, `goals`, `milestones`, `tasks`,
`blocks`, `templates`, `recurringRules`, `sessions`, `papers`, `questions`,
`attempts`, `revisionPlans`, `revisionEntries`, `resources`, `attachments`,
`habits`, `activities`, `xp`, `achievements`, `snapshots`, `planRuns`,
`backups`.

Indexes are chosen for the hot query paths rather than for completeness —
compound indexes such as `[date+start]` on blocks, `[status+dueDate]` on tasks,
`[trackerId+date]` on activities and `[dueDate+status]` on revision entries keep
day/week views an index range scan instead of a table scan, so the app stays
responsive with years of history. `AnalyticsSnapshot` rows cache period
roll-ups; they are derived data and always safe to delete.

### PWA / offline

`vite-plugin-pwa` (Workbox, `registerType: 'autoUpdate'`) precaches the built
app shell and assets and serves `index.html` as the navigation fallback, with
`injectRegister: 'auto'` handling service-worker registration at build time (the
app code does not import a registration module itself). After the first load the
app is installable and fully functional offline: all reads and writes are local
IndexedDB operations. Notifications, when enabled, use the browser's own
`Notification` API and degrade silently where unsupported. Note that the service
worker is disabled in dev (`devOptions.enabled: false`) — verify offline
behaviour with `npm run build && npm run preview`.

---

## Offline and data ownership

**All of your data lives in this browser's IndexedDB, on this machine.** Nothing
is uploaded, there is no account, no telemetry and no cloud copy. That is the
point — and it is also the risk:

- Clearing site data, using a private window, or wiping the browser profile
  **deletes your LifeOS data permanently**.
- A different browser or a different device is a different, empty database.

So: **export regularly.** Settings → Your data offers full JSON export (with
optional attachments) and import with schema validation and versioned
migrations, plus automatic local snapshots kept inside IndexedDB. Local
snapshots protect you from mistakes inside the app; only a file export protects
you from losing the browser profile. Settings can also request persistent
storage from the browser, which makes eviction under storage pressure less
likely.

---

## Feature tour

**Home** — a calm dashboard, not an analytics wall: greeting, what is happening
now or next, today's progress ring, time tracked by tracker, active goal
progress, streak and level, plus quick-add and the tasks that need attention.

**Schedule** — day / week / timeline / agenda views with drag, resize, move,
duplicate, split, delete, lock and protect. Blocks attach to a task, goal or
resource, start a timer, complete, skip or convert to/from a task. Colour-coded
by tracker. The plan panel runs the SchedulingEngine with an impact preview
(current plan vs proposed plan, with a reason per placement), overload
detection, conflict resolution and undo for everything.

**Tasks** — full task model: tracker, goal, milestone, parent task, type,
estimate, due date and hard/soft deadline, dependencies, tags, preferred time
window, intensity, splittability, session bounds, resources, plus a complete
status history (Inbox / Planned / In Progress / Completed / Skipped /
Rescheduled / Cancelled). Filtering, bulk edits and direct scheduling.

**Goals** — Goal → Milestone → Task hierarchy with completion, metric, time and
habit goal types; progress and pace are computed from linked tasks, milestones
and Activity records.

**Focus** — Focus, Pomodoro, Stopwatch and Countdown timers. Every run writes a
persistent `TimerSession` plus an Activity tied to the task/goal/tracker, so
tracked time is real, not typed in.

**Paper Mode** — multi-subject mock test builder with a per-question timer,
per-question status (Correct / Incorrect / Skipped / Marked), automatic time
capture on navigation, and mistake classification (didn't know the concept /
conceptual / calculation / silly / misread / time pressure / guess / other)
feeding the study analytics.

**Revision** — spaced-repetition plans with Due Today / Tomorrow / Upcoming /
Overdue / Recently Completed views; missed revisions are handled through the
rescheduling engine.

**Trackers** — the tracker tree behind everything: four pillars (Study, Fitness,
Skills, Personal) plus system trackers (Sleep, School, Meals, Break, Free), with
per-tracker colours and weekly time targets.

**Analytics** — separate focused sections (Overview, Study, Fitness, Skills,
Personal, Time, Goals) computed from real Activity, Task, TimerSession and
QuestionAttempt records. No hardcoded numbers anywhere.

**Daily Review** — a guided close-out for a day, not a dashboard. Step 1 recaps
what the day contained: completed vs still-open tasks, time tracked against time
planned, block completion, tracker breakdown and the goals that gained time.
Step 2 walks every incomplete task in sequence and offers, for each one, the
options the ReschedulingEngine actually costed against your calendar — move to
tomorrow, find the next available slot, split into sessions, schedule manually,
or cancel — showing the engine's own explanation and a before/after schedule
preview before you confirm. Step 3 summarises exactly what was rescheduled and
where it landed, with per-change undo. Day navigation moves through history.

**Weekly Review** — tasks completed, time by pillar, day-by-day activity,
planned vs actual, questions completed with the accuracy change against the
previous week, revision completion rate and goal progress. It names the area
with the most recorded time and the area furthest below its own configured
weekly target — and prints the supporting numbers next to both, so every
conclusion can be checked. No motivational filler and no judgement the data does
not support. Week navigation moves through history.

**Achievements** — unlocked automatically from measurable events across Study,
Goals, Skills and Consistency, with anti-farming safeguards in the XP engine.

**Settings** — theme, week start, default durations, Pomodoro config, revision
intervals, XP config, notification preferences, scheduling preferences
(including auto-reschedule), working hours, focus hours, protected time blocks,
break preferences, storage report and JSON export/import.

Both review flows are reachable at `/review/daily` and `/review/weekly`, and
link to each other.

---

## Tech stack

React 18 · TypeScript (strict) · Vite 5 · Tailwind CSS 3 · Dexie 4 +
dexie-react-hooks · Zustand · react-router 6 · react-window · lucide-react ·
vite-plugin-pwa · Vitest.

Two notes on what is *not* used: the timeline's drag/resize is hand-rolled on
pointer events (`useTimelineDrag.ts`) for exact pixel→minute snapping, and the
charts are small hand-written SVG components (`src/components/charts/`) rather
than a charting library. `@dnd-kit` and `recharts` remain in `package.json` from
earlier iterations but are not imported anywhere.
