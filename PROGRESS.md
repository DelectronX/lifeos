# LifeOS — build progress

Offline-first personal productivity OS. See `SPEC.md` for the full product
specification and `README.md` for setup and architecture.

Current state: **`npm run build` green, `npx tsc --noEmit` clean, `npx vitest run`
346 tests passing across 16 files.**

---

## Complete

### Phase 1 — Foundation
Vite + React 18 + TypeScript (strict), Tailwind design system, Dexie schema for
all 23 entities with compound indexes on the hot query paths, universal Activity
model that every module writes through, app shell + routing, base UI primitives.

### Phase 2 — Core productivity
Tasks module (full field set, 7-state machine with preserved status history,
grouping/filtering/search, bulk actions). Schedule module (day/week/timeline/
agenda views, hand-rolled drag + resize with snapping, block inspector,
templates, recurring rules with exceptions and this/future/series edit
semantics). Goals → Milestones → Tasks hierarchy with automatic progress.

### Phase 3 — Scheduling intelligence
Pure, testable engines in `src/engines/` — no Dexie, no React, every entry point
takes `now: Date`:
- `priorityScoring` — 8-term weighted score returning a per-term breakdown
- `scheduling` — free-slot computation, greedy placement with deadlines,
  splitting, Kahn topological dependency ordering, break padding; returns
  unplaced tasks with coded reasons
- `rescheduling` — remaining-work calculation, seven costed options each with a
  human-readable explanation, auto mode, overload detection
- `conflictResolution` — five shift strategies, each with a before/after preview
  and plain-English rationale; returns proposals only, never mutates
- `durationPrediction` — estimated-vs-actual patterns with confidence tiers
- `revisionScheduling` — interval ladders, SM-2, missed-revision recomputation

`src/services/planService.ts` provides the apply/undo persistence layer with
snapshot-based revert.

### Phase 4 — Execution
Focus / Pomodoro / Stopwatch / Countdown timers. Timer state is computed from
wall-clock timestamps, so a refresh mid-session resumes correctly. Completion
writes a real TimerSession + Activity record and awards XP.

### Phase 5 — Learning
Paper Mode: multi-subject builder, per-question timing that accumulates across
revisits, question palette, mistake classification, and a pure
`paperAnalytics` engine (score, accuracy, median/fastest/slowest, subject
breakdown, mistake aggregation) behind a sortable review UI.

### Phase 6 — Growth
Revision dashboard (due today / tomorrow / upcoming / overdue / recent), XP and
level system with anti-farming safeguards, achievements, Daily Review (guided
three-step triage wired to the rescheduling engine with real Undo), Weekly
Review (conclusions printed beside their supporting numbers).

### Phase 7 — Analytics
Pure `analytics` engine plus seven focused sections (Overview, Study, Fitness,
Skills, Personal, Time, Goals), a shared range selector, planning-accuracy
insights, and tracker pillar pages driven by one universal parameterised
implementation. No hardcoded numbers anywhere.

### Phase 8 — Offline reliability
PWA service worker + manifest + generated icons, JSON export/import with
validation and versioned migrations, local file attachments as IndexedDB blobs,
full Settings page, chunk splitting.

---

## In progress — resume here

Three agents were stopped mid-task at a clean, compiling checkpoint. All work
below is committed and building; what remains is finishing and verification.

### A. Dark OS-style redesign — partially landed
**Done:** the complete dark-default token layer in `src/index.css` (surface
luminance steps, hairlines, single blue-violet accent, radii/shadow/motion
variables — depth comes from luminance and hairlines, not glassmorphism),
`tailwind.config.js` wired to those tokens, restyled Button/Card/Badge/Input,
new EmptyState/Kbd/Separator/Skeleton/SegmentedControl/Tooltip primitives,
`src/lib/theme.ts`, `src/lib/fuzzy.ts`, `src/lib/platform.ts`, and new shell
pieces: `SidebarRail`, `WindowChrome`, `IdentityBlock`, `MobileShell`,
`ShellContext`, `navigation.ts`, plus `src/components/system/CommandPalette.tsx`
and `commands.ts`.

**Remaining:**
- Verify the new shell and command palette in a real browser at 390px and
  1440px; iterate on spacing, active states and motion until it reads as a calm
  OS rather than a dashboard template.
- Write `src/components/ui/README.md` documenting the tokens and every
  primitive — the feature-page restyle wave depends on it.
- **Feature pages have NOT been restyled onto the new tokens yet.** This is the
  largest remaining visual task: Home, Schedule, Tasks, Goals, Focus, Revision,
  Trackers, Analytics, Achievements, Review, Settings.

### B. Achievements + custom Rewards — mostly landed
**Done:** achievements expanded from 34 to **86 definitions** across the
extended category set (study, goals, skills, consistency, fitness, mastery,
revision, focus, planning, personal). `src/engines/conditionEngine.ts` (pure
condition AST: leaf comparisons over metrics with time windows, AND/OR/NOT
composition, per-leaf evaluation traces, progress computation) with a test
suite. `src/config/rewards.ts`, `src/services/rewardService.ts`, and the UI:
`ConditionBuilder.tsx`, `RewardEditor.tsx`, `RewardsSection.tsx`.

**Remaining:**
- Confirm every new achievement's stat is actually computed in
  `achievementService.computeStats` — some may still be unimplemented.
- Browser-verify the condition builder end to end: create a custom reward,
  confirm it persists across a refresh and that its evaluation trace matches
  real stored data.

### C. JSON file storage — partially landed
The user does **not** run this in a desktop browser; they open it from an iOS
file-manager/FTP app. All data, **including user settings**, must live in JSON
files rather than inside IndexedDB.

**Done:** `src/storage/` with `types.ts`, `detect.ts`, `envelope.ts`,
`dirtyTracker.ts`, `bundle.ts`, `repository.ts`, `boot.ts`, an `adapters/`
directory and tests; plus `src/features/settings/StorageSettings.tsx` and
edits to `backupService`, `migrationService`, `settingsService`, `main.tsx`.

**Design:** one `StorageAdapter` interface with several backends, auto-detected
at boot, because a webview cannot silently write to arbitrary disk paths:
1. **HTTP/WebDAV** — if served over `http://` and the origin accepts PUT,
   saving is fully automatic. Best case.
2. **File System Access API** — user picks a folder once; real file writes
   thereafter.
3. **Manual file mode** — universal fallback: import a JSON bundle, save/export
   it back, with a visible unsaved-changes indicator.

Layout: one JSON file per entity type in `data/` (`tasks.json`, `goals.json`,
`settings.json`, …) plus `manifest.json`, and a single `lifeos.json` bundle for
transport. IndexedDB remains as a fast local cache so live queries and
performance are unaffected; existing IndexedDB data migrates into files on
first save.

**Remaining:**
- Verify the boot/hydrate path end to end and the one-time IndexedDB → files
  migration.
- Confirm settings genuinely persist to `settings.json` (localStorage retained
  only as a boot-time theme cache to avoid a flash).
- Browser-verify each adapter's detection and the manual save/export/import
  flow.
- **Open question for the user:** does their iOS file app expose a web server /
  WebDAV / Wi-Fi transfer option? That determines whether they get silent
  auto-save or a manual Save button.

---

## Known gaps (verified against the code, not assumed)

- Full-auto rescheduling has no UI entry point — the engine and the apply/undo
  layer both exist, but nothing triggers `autoReschedule`.
- `rollSnapshots` is written but never invoked; the automatic backup lifecycle
  is not wired to a schedule.
- Notification scheduling is settings-only — no reminders actually fire from
  stored data while the app is open.
- **No preloaded demo data.** Requested but not yet built: a deterministic,
  seeded, internally-consistent dataset spanning ~8-10 weeks so every screen
  opens populated.
- Test coverage is engine-heavy. All 346 tests are pure-engine/storage; the
  React layer is verified by manual browser QA only.
- `ScheduleTaskModal` doesn't report its result, so the manual-scheduling path
  reads blocks back from Dexie to report accurately. Works, but a return value
  would be cleaner.

---

## iOS / Capacitor readiness

The web project is Capacitor-ready but **no native platform has been added**.
That step needs Xcode on a macOS machine and was intentionally not run here.

**Installed / configured now:**
- `@capacitor/core`, `@capacitor/cli` (dev dep).
- Plugins installed but not deeply wired yet: `@capacitor/preferences`,
  `@capacitor/filesystem`, `@capacitor/status-bar`, `@capacitor/keyboard`,
  `@capacitor/haptics`, `@capacitor/app`, `@capacitor/share`.
- `capacitor.config.ts` at the repo root — `appId: com.lifeos.app`,
  `webDir: 'dist'`, dark background colour, `webContentsDebuggingEnabled`
  for dev builds.
- `.gitignore` excludes future `ios/` and `android/` platform directories.
- `src/lib/nativeBridge.ts` — a guarded wrapper (`isNativePlatform()`,
  `syncStatusBarTheme()`) that no-ops outside a real native WebView. Wired
  into `src/lib/theme.ts` so the status bar follows the app's theme once a
  native shell exists.
- Safe-area (`env(safe-area-inset-*)`) support: `viewport-fit=cover` in
  `index.html`, `--safe-*` CSS vars + `.pt/.pb/.pl/.pr-safe` utilities in
  `index.css`, applied to `AppShell`, `SidebarRail`, `MobileTopBar`,
  `MobileTabBar`/`MobileMoreSheet` (already had bottom insets), and `Modal`.
- Touch targets: `IconButton` now has an invisible `before:inset-[-6px]`
  hit-area on every size so small icon buttons meet the ~44px iOS minimum
  without changing their visual size. Mobile top-bar search button and the
  "More" sheet close button bumped to real 44px/36px hit boxes.
- Hover-only affordance fixed: `TaskRow`'s "Schedule" icon button no longer
  disappears with no touch fallback — it's visible by default and only
  hides on hover-capable (desktop) pointers via `[@media(hover:hover)]`.

**Commands the user runs later, on a Mac:**
```bash
npm install                # if not already
npm run build               # produces dist/, which webDir points at
npx cap add ios             # generates the ios/ Xcode project (needs Xcode)
npx cap sync ios            # copies web build + plugins into the native project
npx cap open ios            # opens Xcode to build/run/sign
```
Re-run `npm run build && npx cap sync ios` after every web change before
testing on device/simulator.

**Native plugin wiring still to do** (by whichever feature wave needs it):
- `@capacitor/filesystem` — back file attachments / a future PDF viewer with
  native file access (currently IndexedDB blobs only).
- `@capacitor/preferences` — only for tiny OS-level flags if ever needed; the
  app's own JSON/IndexedDB storage layer (`src/storage/`) stays authoritative
  for real data, do not use Preferences for bulk data.
- `@capacitor/haptics` — light haptic feedback on task/timer completion.
- `@capacitor/share` — share exported JSON bundles via the iOS share sheet.
- `@capacitor/app` — handle background/foreground app-state transitions to
  keep timers accurate (coordinate with whoever owns `timerService.ts`).
- `@capacitor/keyboard` — not yet imported; current keyboard-safety relies on
  the browser's native behaviour (modals already avoid pinning to the
  viewport bottom without safe padding). Revisit once running in a real
  WKWebView, where keyboard resize behaviour differs from Safari.

