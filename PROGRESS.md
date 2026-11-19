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


## Personal configuration + overlap pass (Oct 2026)
- Storage: browser-only (IndexedDB / site data). Demo data removed; Settings → Data → "Clear all data".
- Auto Plan: same-area tasks are hosted inside matching subject blocks; other-area overlaps are offered as choices (never applied silently). Manual scheduling asks before overlapping.
- Generic engines: cycles (engines/cycles.ts), optional blocks, data-defined achievements (engines/customMetrics.ts), per-tracker XP + bonuses, reward currency ledger (services/currencyService.ts) + redeemable rewards, sequential goals (one active project).
- Config import: services/configService.ts (validate + idempotent merge), Settings → Data → Apply configuration. Personal data lives in config/lifeos-config.json (not source).
- Tests: services/__tests__/lifeosConfig.test.ts. Suite 470/470, build green.


## Work & Growth upgrade (2026-11-18)

Backbone: Goal -> Milestones -> Tasks -> scheduled blocks -> completion -> XP -> achievements -> rewards.
- Schema v9 (additive, migration V8_TO_V9): checklists, checklistRuns, projects, contacts, money, skills, studies, sources, examTracks, scores.
- Last task of a milestone completes it automatically (goalService.syncMilestoneFromTasks); reopening reverses it. Milestones now bank xp.awards.milestone_completed and revoke on reopen.
- Projects and research studies OWN a goal; their milestones/tasks are ordinary rows (Tasks, Auto Plan, XP all apply). No parallel task system.
- Checklists: daily / weekly / monthly templates, one run per period (date / ISO week / month), per-weekday daily items, due day, streaks, completionXP once per period (revoked on untick).
- Earning: CRM pipeline (lead -> client) with timeline + follow-ups, money ledger (active vs passive income, invoices, overdue, expenses), weighted pipeline, win rate, effective hourly rate; won deal -> client project.
- Research: studies (literature review / paper / experiment) with stage stepper, protocol, themes + thin-evidence gaps, manuscript sections with word counts, source library with literature matrix and reference paste-parser.
- Skills: levels 0-5 vs target, learning path, evidence.
- Exams: generic exam tracks (SAT scaled sections, AP 1-5) with score log, trend vs target, countdown, domain accuracy + mistake mix from Practice papers.
- Achievements: new metric families events:<activityType>, checklists:<cadence>, earned:<*|active|passive>; categories research + earning.
- Home "Up next" card; Apple HIG pass (semantic grouped colours, systemBlue default + accent picker, 17pt touch scale, material bars, accent sidebar selection, borderless grouped cells).
- Personal data in config/lifeos-my-schedule.json: 25 goals / 110 milestones, 6 projects, 7 studies, 9 skills, 3 exam tracks, 4 checklists (daily, habits, weekly, monthly review), 58 personal achievements (143 total).
- Tests: 33 files / 497 passing (src/services/__tests__/workgrowth.test.ts).


## UI redesign — Apple HIG / premium pass (2026-11-18)

Signature: the Day Ribbon (src/features/schedule/dayRibbon.tsx) and the Live Activity capsule in the top bar (NowStrip.tsx, Dynamic-Island black in both themes). Brand mark = day dial (BrandMark.tsx).
Tokens (src/index.css): layered graphite #0A0A0B / #111113 / #18181B / #222226, fills #27272C; hairline-light elevation (no dark shadows); radii 6/8/10/14/18/26; accent #0071E3 (4.7:1 under white); SF Pro + SF Pro Rounded (.t-rounded/.t-metric) for numerals only; materials only on bars/sheets/menus/palette.
Controls: filled/gray/tinted/plain buttons (capsules when small), filled inputs with focus ring, iOS switch, sliding segmented thumb, sheet modals with grabber, HUD toasts, Spotlight-style palette, iOS-Settings grouped sections, Apple Calendar blocks.
Shell: sidebar source list with search, calm gray selection + accent symbols; top bar transparent until content scrolls, then material + inline title.
Verified: 23 routes × dark/light at 1440px and 8 key routes × dark/light at iPad 820px — 0 contrast failures (WCAG AA computed per text node), 0 horizontal overflow, 0 runtime errors; 44pt hit areas on touch via .touch-hit.

## Shell redesign — centred stage + Liquid Glass (2026-11-18)

Layout: content is one centred column scrolling under floating Liquid Glass chrome over an ambient field (AppShell.tsx). Nothing is pinned to window edges.
- FloatingSidebar.tsx: detached glass sidebar (12px float, r=28), springs 260↔72px, sliding selection pill.
- Notch (NowStrip.tsx `Notch`): black Dynamic-Island capsule at top centre; hover/tap morphs into a live panel (block, progress, Start/Done/Skip, next 3, cycle phase, Close the day).
- ShellChrome.tsx: TitleCluster (inline title slides in on scroll), StatusCluster (search, save, clock, appearance), Dock (floating glass tab bar with sliding pill, <1024px).
- Toaster.tsx: floating notifications drop from under the notch, stack iOS-style, pause on hover, countdown hairline, swipe up to dismiss.
- Page.tsx: centred eyebrow/title/subtitle/actions; sections stagger in; route transitions.
- index.css: .glass / .glass-regular / .island / .glass-pill / .ambient-stage / scroll-edge; Reduce Transparency + Increase Contrast + Reduce Motion fallbacks. --stage-shift keeps notch and banners on the content axis.
Verified: 21 routes × dark/light @1440, 9 routes × dark/light @iPad 820 — 0 errors, 0 overflow, 0 contrast failures; 390px phone: dock/notch/clusters don't collide.


## Overhaul — dark OS shell, ASCII galaxy, notifications, modes, partial payments (2026-11-19)

Baseline (measured before changes, 1440x900, Home idle 3 s): aurora blobs 607 ms main-thread / 3 s; previous canvas ASCII 1,057 ms / 3 s with 12 long tasks on navigation; layout audit 35/63 route x size combos failing (dock not centred: entrance animation's transform cancelled -translate-x-1/2; schedule inspector + "Ran over?" card taller than the viewport).
After: galaxy background ~150 ms / 3 s over no background (paused while scrolling/dragging/overlays), p95 frame 7.1 ms, 0 long tasks; 0/63 layout failures; 0 contrast failures dark+light; 500/500 tests.

- Background + loading screen: ASCII Magic "spiral-galaxy" (MIT) self-hosted in public/ascii (offline PWA); two documented local patches (fps cap, global pause) in public/ascii/LOCAL_CHANGES.md. Old SVG preloader removed.
- Shell: single compact header (brand, breadcrumb, notch centred on the viewport axis, date/time, save, search, notifications, identity ring, settings); bottom dock replaces the sidebar (centred by a non-animated row); Apps launcher (grouped, ranked search, Simple/Advanced switch). Sidebar/rail/mobile shell files deleted after verifying no imports.
- Overlays: Tooltip portalled with flip/clamp; Menu measured collision + arrow/Home/End + focus return; Modal opaque, dvh-capped; Escape layered (menu → drawer).
- Schedule: block grammar (work solid+bar, pauses dashed, sleep hatched, protected striped, live dot), 4 text tiers by height, past shading, now chip; inspector is a viewport-anchored drawer (sheet <1024px) with sections, collapsed Links/Protection, sticky actions + More menu; timeline padded by the drawer's exact overlap.
- Notifications: Notification Center (localStorage, 250 cap) fed by every toast (category inferred from route), real activity events (after commit), and a minute sweep (block soon / ended unlogged, tasks due/overdue, invoices overdue, follow-ups, revision due, open checklists, close the day). Per-category banners, quiet hours, OS mirroring when hidden.
- Simple / Advanced mode (settings.appearance.mode): Advanced-only destinations and Planning/Maintenance/Reset settings.
- Earning: partial payments (MoneyEntry.payments; revenue recognised per instalment date; balanceDue/outstanding; markPaid records only the remainder; overpay refused; each instalment = one payment_received event) + BarChart; tests added.
- Modules: Goals MilestoneTrack, Projects lifecycle stepper + per-milestone segmented progress, Checklists ring + per-item segments, Tasks priority edge + check pop, Focus bezel dial.
