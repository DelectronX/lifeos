# LifeOS — Offline-First Personal Productivity & Growth System

You are building a production-quality, offline-first personal productivity and growth web app called "LifeOS" in this directory (D:/lifeos). Follow this spec exactly. Build in the phases described at the end. Commit to git after each phase completes and compiles/builds successfully.

## Vision
Not a generic to-do/calendar/habit app. It is a personal operating system across four pillars: Study, Fitness, Skills, Personal — all powered by ONE universal activity architecture (tasks/goals/schedule/timer/resources/XP all reference the same underlying Activity records), not four separate silos.

## Hard constraints
- 100% offline-capable after first load: no backend server required for normal operation, no cloud DB, no auth, no required external API calls for core functionality.
- Frontend: React + TypeScript, component-based, Vite for tooling (fast local dev, works fine offline once deps installed).
- Storage: IndexedDB via Dexie.js for structured data; LocalStorage only for small prefs; Blob storage (in IndexedDB) for imported files/attachments.
- Styling: Tailwind CSS with a clean, restrained design system (calm, professional, minimal — NOT a gamified/cyberpunk/neon SaaS template look).
- PWA: installable, offline service worker (vite-plugin-pwa), works with no network.
- Business logic must live in a separate `src/engines/` or `src/services/` layer, framework-agnostic where possible, unit-testable independent of React (use Vitest).
- No single giant component or god state object. Use a clean service layer + domain models + React state (Zustand or Context, your choice) that reads from Dexie via live queries (dexie-react-hooks).

## Core architecture requirements
1. Universal Activity model: every trackable thing (task, schedule block, timer session, revision, paper attempt) is an Activity or references a Task, and Tasks/ScheduleBlocks/Goals/Trackers/Resources/Timers/XP/Revisions all relate through shared IDs — no duplicate parallel systems per pillar.
2. Data entities (Dexie tables): UserProfile, Tracker, Goal, Milestone, Task, ScheduleBlock, ScheduleTemplate, RecurringRule, TimerSession, Paper, Question, QuestionAttempt, RevisionPlan, RevisionEntry, Resource, Attachment, Habit, Activity, XPTransaction, Achievement, AnalyticsSnapshot, Settings.
3. Independent, testable engines in src/engines/: SchedulingEngine, ReschedulingEngine, ConflictResolutionEngine, PriorityScoringEngine, DurationPredictionEngine, RevisionSchedulingEngine, GoalProgressEngine, AnalyticsEngine, XPEngine, AchievementEngine. All deterministic, rule-based, config-driven (central `src/config/schedulingConfig.ts`), NO AI/external API calls. Write Vitest unit tests for each engine's core algorithm.
4. Priority scoring formula (configurable weights in schedulingConfig.ts): combine basePriority, deadlineUrgency, goalWeight, overduePenalty, dependencyWeight, revisionWeight into a transparent priorityScore.
5. Scheduling engine: places tasks into available slots respecting fixed/locked/protected blocks (sleep, school, meals), deadlines, priority, preferred time windows, min/max session duration, splitting, dependencies, breaks between intensive sessions.
6. Rescheduling engine: handles incomplete/skipped/overrun tasks — offers move to tomorrow / find next slot / split / move lower-priority task / manual / cancel, plus an optional full-auto mode; every automated change must produce a human-readable explanation and be undoable.
7. Conflict/shift engine: when a task overruns, evaluate downstream fixed vs flexible blocks and propose a schedule impact preview (current plan vs proposed plan with reasons) before applying.
8. Duration Prediction Engine: compares historical estimated vs actual duration per task-type/subject and surfaces suggested durations (visible, not auto-applied without confirmation).
9. XP/Level/Achievement engines: configurable XP table, level curve, and automatically-derived achievements from measurable events (with anti-farming safeguards — no XP for meaningless create/cancel loops).
10. Revision engine: default spaced repetition intervals (configurable), manual overrides, missed-revision handling via the rescheduling engine.

## UI / navigation
Primary nav: Home, Schedule, Tasks, Goals, Focus, Revision, Trackers, Analytics, Achievements, Settings.
Home dashboard stays calm/focused: greeting, date, today's progress %, tasks completed/total, next up activity, today's tracker time breakdown, active goal progress bars, streak, XP/level. NOT a big analytics wall.
Schedule module: day/week/timeline/agenda views; blocks support drag/resize/move/duplicate/delete/split/attach task-goal-resource/start timer/complete/skip/reschedule/convert task<->block; color-coded by tracker (Study/Fitness/Skills/Personal/Break/Sleep/Meals/School/Free) with a restrained subtle palette.
Tasks module: full task fields incl. status history (Inbox/Planned/In Progress/Completed/Skipped/Rescheduled/Cancelled).
Goals module: Goal -> Milestone -> Task hierarchy, multiple goal types, auto progress.
Focus module: Focus timer, Pomodoro, Stopwatch, Countdown, Paper Mode, Question Mode; every session -> persistent TimerSession + Activity record.
Paper Mode: multi-subject mock test builder, per-question timer, status (Correct/Incorrect/Skipped/Marked), auto-saves time per question on navigation.
Revision dashboard: Due Today/Tomorrow/Upcoming/Overdue/Recently Completed.
Analytics: separate focused sections (Overview, Study, Fitness, Skills, Personal, Time, Goals) — not one giant page. Include mistake-classification aggregation (didn't know concept / conceptual / calculation / silly / misread / time pressure / guess / other) for incorrect paper questions.
Achievements: auto-generated from measurable events across Study/Goals/Skills/Consistency categories.
Settings: theme, week start day, default durations, pomodoro config, revision intervals, XP config, notification prefs, scheduling prefs (auto-reschedule on/off), protected time blocks, working hours, focus hours, break prefs, JSON export/import with validation and versioned migrations.
Daily Review + Weekly Review flows integrated with the rescheduling engine, deriving conclusions only from real stored data (no fabricated insights).

## Responsiveness & performance
Responsive desktop/tablet/mobile (mobile prioritizes Today/Next task/Quick add/Timer/Schedule/Daily review). Virtualize long lists (react-window) where needed. Must stay fast with thousands of tasks/years of history — design Dexie indexes accordingly.

## Data safety
Full JSON export/import with schema validation, versioned migrations for future schema changes, and an "About my data" note that all data stays local in IndexedDB, exportable any time.

## Build order (work through phases sequentially, run `npm run build` and fix errors before moving to next phase, commit git after each phase):
PHASE 1: Vite+React+TS scaffold, Tailwind, Dexie schema for all entities, universal Activity system, app shell/navigation/routing (react-router), base design system (typography, spacing, color tokens, base components: Button, Card, Badge, Input, Modal, Tabs).
PHASE 2: Tasks CRUD + list/board views, Schedule module with day/week timeline views and drag/resize (use a library like @dnd-kit or custom), Goals + Milestones CRUD linked to tasks.
PHASE 3: schedulingConfig.ts + PriorityScoringEngine + SchedulingEngine + ReschedulingEngine + ConflictResolutionEngine + DurationPredictionEngine, wired into Schedule UI with impact-preview + explain + undo.
PHASE 4: Focus/Pomodoro/Stopwatch/Countdown timers writing real TimerSession + Activity records tied to tasks/goals/trackers.
PHASE 5: Paper Mode + question timer + mistake classification + paper analytics.
PHASE 6: Revision engine + Revision dashboard, XP engine, Level system, Achievement engine, Daily Review, Weekly Review.
PHASE 7: Analytics sections (Overview/Study/Fitness/Skills/Personal/Time/Goals) computed from real Activity/Task/TimerSession data (no hardcoded numbers).
PHASE 8: PWA/service worker offline support, JSON export/import + migrations, performance pass (virtualized lists, Dexie indexes), Settings page wiring all config, final polish pass on visual design, Vitest tests for engines, README with setup/run instructions (`npm install && npm run dev`).

Work autonomously through as many phases as you can. After finishing a phase, append a short status line to PROGRESS.md in the repo root stating what phase completed and what remains, then continue to the next phase without waiting for confirmation. If you run low on remaining turns, stop at a clean, buildable state and leave clear notes in PROGRESS.md about exactly what to resume next.
