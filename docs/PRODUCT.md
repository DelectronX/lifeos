# LifeOS → Product Plan

> Working name: **LifeOS**. The name must change before any public launch — see [§3 Name & trademark](#3-name--trademark).
> Owner: Chitraksh Kumar (Aksh). Status: planning. Last updated: 19 Nov 2026.

This document turns LifeOS from a personal tool into a product other people can use, pay for and trust. It records the decisions already made, the full scope we discussed, and the order to build it in.

---

## Contents

1. [Decisions](#1-decisions)
2. [Who it is for](#2-who-it-is-for)
3. [Name & trademark](#3-name--trademark)
4. [Where LifeOS is today](#4-where-lifeos-is-today)
5. [Product principles](#5-product-principles)
6. [Product structure (modules)](#6-product-structure-modules)
7. [Agentic Home](#7-agentic-home)
8. [Notes](#8-notes)
9. [Whiteboard](#9-whiteboard)
10. [Work: CRM + PMS + money](#10-work-crm--pms--money)
11. [Know: research, CMS, exam mode](#11-know-research-cms-exam-mode)
12. [Onboarding & templates](#12-onboarding--templates)
13. [More features worth building](#13-more-features-worth-building)
14. [Data, database & sync](#14-data-database--sync)
15. [Accounts, login & data collection](#15-accounts-login--data-collection)
16. [AI: three approaches](#16-ai-three-approaches)
17. [Subscriptions & pricing](#17-subscriptions--pricing)
18. [Open source model](#18-open-source-model)
19. [Native applications](#19-native-applications)
20. [Repository restructure](#20-repository-restructure)
21. [Clean-up, debloat & duplicate removal](#21-clean-up-debloat--duplicate-removal)
22. [Quality, security & reliability](#22-quality-security--reliability)
23. [Accessibility & localisation](#23-accessibility--localisation)
24. [Backend & operations](#24-backend--operations)
25. [Legal & business](#25-legal--business)
26. [Go-to-market](#26-go-to-market)
27. [What to postpone](#27-what-to-postpone)
28. [Costs](#28-costs)
29. [Roadmap](#29-roadmap)
30. [Metrics](#30-metrics)
31. [Open questions](#31-open-questions)

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Audience | Students who study **and** earn / run a business; adults managing work alongside their own startup or side business. |
| Account & payment holder | Aksh holds all developer, store and payment accounts (see the age constraint in §25). |
| Source model | **Open source.** |
| AI approach | **All three**: hosted AI (credits), bring-your-own API key, and local models. |
| Storage philosophy | Local-first stays the core. Sync is an optional, encrypted add-on. |
| Name | "LifeOS" is not usable as a product name (§3). Rename before launch. |
| Team size | Solo builder first; Teams tier later. |

---

## 2. Who it is for

**Primary: student-builders.** A student preparing for exams (CBSE, JEE, SAT, AP…) who is also freelancing, building projects, doing research or running a small business. Nobody serves this person well today: study apps ignore the business, business tools ignore the studies, and calendars don't know about either.

**Secondary: adult operators.** People with a job *and* their own startup, side business or freelance work, who need one place where time, goals, clients, projects and learning connect.

**The job to be done:** "Plan my whole life across study, work and business; tell me honestly whether I'm on track; let my AI do the busywork."

**What we are not:** a Notion clone, a HubSpot rival, a team project tool, or a generic to-do list.

---

## 3. Name & trademark

### Findings (quick search, 19 Nov 2026 — not legal clearance)

"LifeOS" is unavailable as a product brand:

- **US (USPTO):**
  - a **live registration** for "LIFEOS" in **class 9 (software)** (serial 87937316), which conflicts directly with an app;
  - pending applications by **Ali Abdaal Ltd** (serial 99167274; a major productivity creator) and **Nexxbase Technologies** (serial 99725924);
  - a registration by LifeOS Genomics (90027914).
- **India (IP India):** several "Lifeos" filings (e.g. 7408955 / 7408956 / 7408957; class 36 under examination, others pending).
- **Market:** dozens of products already use the name: Play Store "LifeOS: Focus and Habit Tracker", lifeos.vc, lifeos.md (Obsidian), lifeosmobile.com, runlifeos.com, lifeos.app, getlifeos.app, ourlifeos.ai, an iOS "Life OS: AI Daily Planner", and many Notion templates.

**Conclusion:** keep "LifeOS" only as an internal codename. Pick a new, distinctive (coined) name.

### Candidate names (preliminary)

| Name | Quick-search result |
|---|---|
| Kairnly | No obvious conflict found |
| Tandemly | No obvious conflict found |
| Polymind | No obvious conflict found in productivity; generic risk |
| Juncto | A site exists at juncto.app — weaker |
| Dualis | Existing university-portal software (DUALIS) — avoid |
| Braidly, Selvane, Stridewise | Taken — avoid |

### Clearance checklist for the chosen name

1. Search **IP India** (tmrsearch.ipindia.gov.in) in **classes 9, 42, 35 and 41**.
2. Search **USPTO** (tmsearch.uspto.gov), **EUIPO / TMview**, and **WIPO Global Brand Database**.
3. Check Play Store and App Store search, GitHub, npm, and social handles.
4. Buy the domain (.app / .com / .in) and claim the handles.
5. File in **India first** (classes 9 + 42). Consider a Madrid filing (US/EU) once there is traction.
6. Use a trademark attorney for the final clearance opinion.

---

## 4. Where LifeOS is today

**Stack:** React 18 + TypeScript + Vite + Tailwind; Dexie (IndexedDB) as the database; PWA (iPad Home Screen); Capacitor config present; Vitest.

**Data:** everything lives in the browser's IndexedDB. The schema has versioned migrations (Dexie v10, bundle schema v9) and an additive audit log.

**Built:**

- **Core:** Schedule/calendar, tasks, goals and milestones, trackers (areas/subjects), recurring rules, Auto Plan.
- **Progress:** an honest XP/levels system (no XP for merely scheduling), data-driven achievements with a condition engine, rewards and a reward currency.
- **Work & Growth:** checklists (daily/weekly/monthly), projects, contacts/CRM pipeline, money ledger with partial payments, skills, research studies and sources, exam tracks and scores, revision engine, focus timer, analytics and reviews.
- **Home:** 21 widget types.
- **Notifications:** one reminder engine, desktop notifications and synthesised sounds.
- **Agent integration:**
  - a local MCP server (official SDK, stdio + Streamable HTTP), REST API, OpenAPI 3.1 and CLI;
  - **121 operations**, with permission levels, idempotency keys, optimistic concurrency and an audit log;
  - a bridge design: the open app executes requests through the same services the UI uses.
- **Config import:** a "set up my LifeOS" JSON importer, plus a real plan loaded through the agent (2,800 blocks, 180 tasks, 26 goals, 112 achievements).
- **Quality:** 537 passing tests; clean type-check and builds.

**Known gaps:**

- Agents only work while a browser tab is open on the PC.
- iPad and PC data are separate (no sync).
- iOS background notifications are limited.
- Personal data and config live in the repo.
- No licence.
- Several overlapping concepts (see §21).

---

## 5. Product principles

1. **Local-first & private.** The app is fully usable offline with no account. User data is never uploaded unless the user turns on sync, and synced data is end-to-end encrypted.
2. **Agent-native.** Every action a user can take, an AI can take, through one operation catalog (MCP, REST, CLI, in-app AI).
3. **Honest progress.** Only real completion earns XP. Every block has a "done when" test. No fake streaks.
4. **Connected, not collected.** Client → project → tasks → blocks → time → invoice → payment, and goal → milestone → task → block, are one linked model, not separate apps.
5. **Calm & premium.** Dark-first, OS-like, fast, minimal chrome. Never "generic AI SaaS".
6. **Less but better.** One way to do each thing. Every feature earns its place with usage.

---

## 6. Product structure (modules)

Five areas. Every screen belongs to exactly one.

| Area | Contains | Replaces today's |
|---|---|---|
| **Home** | Agentic command centre + live cards | Home widgets |
| **Plan** | Calendar, routines, Auto Plan, templates | Schedule, recurring rules, habits/checklists |
| **Do** | Tasks, focus timer, today view, catch-up | Tasks, focus |
| **Track** | Goals, milestones, progress, XP, achievements, reviews, analytics | Goals, achievements, analytics, reviews |
| **Work** | CRM, projects (PMS), money/invoicing | Earning, projects |
| **Know** | Notes, whiteboard, research/library (CMS), exam mode, flashcards | Research, exams, revision, practice |

---

## 7. Agentic Home

The headline feature. Home becomes a command centre: a chat/command bar at the top and live, clickable cards below.

**Core**

- **One tool catalog:** the in-app agent uses the same 121+ operations as MCP/REST/CLI.
- **Natural language:**
  - "Plan my week around the Physics mock."
  - "I'm sick today — push everything."
  - "Add client Acme, ₹25k audit, invoice due Friday."
- **Plan → preview → apply.** The agent shows a proposed-changes card ("creates 4 blocks, moves 2, adds 1 task"). The user approves or edits. Everything is undoable through the audit log.
- **Rich answers:** answers come back as interactive cards (schedule, charts, task lists), not just text.
- **Input everywhere:** voice input, and a global quick-capture hotkey (desktop).
- **Context:** today, goals, deadlines, history and energy.
- **Editable memory** of preferences ("no deep work after 22:00", "Wednesday is light"), stored locally.

**Proactive (opt-in)**

- **Morning brief:** must-dos, risks, what to drop if the day slips.
- **Midday check-in** when behind.
- **Evening close-the-day:** log what happened, reschedule misses, draft the review.
- **Weekly review** drafted from real data.
- **Overload and burnout warnings** with concrete swaps.

**Automations ("when X then Y")**

- Mock logged → create an analysis block, plus 1/3/7-day error-log reattempts.
- Invoice overdue 3 days → draft a follow-up email.
- Required block missed → propose a reschedule into the next catch-up slot.

**Trust & safety**

- The same permission levels as the agent API (read / write / full); deletes always need confirmation.
- "Explain why" on every change; per-action log.
- Hard rule: the agent never marks work complete on its own (honest XP).
- Prompt-injection defence: notes, web pages and emails are treated as data, never as instructions.
- An evaluation suite of scripted requests that must produce the correct tool calls, run in CI.

---

## 8. Notes

- **Editor:** a block editor (TipTap or Lexical) with markdown shortcuts, slash commands, code, KaTeX maths and tables.
- **Daily note** linked to the day's schedule; a note attached to any block, task, project, client or goal.
- **Links:** `[[backlinks]]` to real records, and a graph view.
- **Live content:** inline tasks are real tasks; embeds of live cards (goal progress, today's blocks).
- **Templates:** lecture notes, meeting notes, literature review, weekly review.
- **Search:** fast local full-text search (MiniSearch on web; SQLite FTS in the native apps).
- **Capture:** web clipper, PDF highlights into notes (PDF annotations already exist), image OCR.
- **History & sync:** version history, offline editing, end-to-end encrypted sync.
- **Sharing:** publish or share a page as a public link.
- **Study:** turn notes into flashcards that feed the existing revision engine.

---

## 9. Whiteboard

- **Engine:** **Excalidraw** (MIT licence, free for commercial use). tldraw needs a paid commercial licence, so it is not the default.
- **Linked boards:** attached to projects, studies and goals.
- **Sticky note → task / milestone / note** in one click; drag tasks onto the board as cards.
- **Diagrams:** mind maps, flowcharts, Mermaid; AI turns text into a diagram and back.
- **Planning canvas:** drag cards onto days to create blocks.
- **Export:** PNG, SVG, PDF.
- **Collaboration:** real-time (Yjs) comes later with the Teams tier.

---

## 10. Work: CRM + PMS + money

Replaces today's Earning and Projects. Aim for "excellent for one operator", not "HubSpot for enterprises".

**CRM**

- Contacts and companies; pipeline board; deals (value, probability, stage).
- Interaction timeline; follow-up reminders.
- Proposal and email templates; Gmail/Outlook sync (later).

**PMS (projects)**

- Board, list, timeline/Gantt and calendar views.
- Subtasks, dependencies, sprints and milestones.
- Time captured automatically from completed blocks.
- Project health; client links; client portal (later).

**Money**

- Proposals → invoices → partial payments (exists) → receipts.
- Expenses, recurring invoices, tax/GST fields, PDF invoices.
- Revenue and profit dashboard; active vs passive streams.

**One linked model:** client → deal → project → tasks → blocks → time → invoice → payment.

---

## 11. Know: research, CMS, exam mode

- **One knowledge area:** notes, sources/library, literature reviews and papers (stages, sections, evidence matrix), citations, flashcards, question bank. One search and one citation system across all of it.
- **Exam mode:** a strong niche feature for students.
  - mock scores, section scores, error log with 1/3/7-day reattempts, weak-topic heatmap;
  - syllabus/chapter tracking;
  - exam-date countdowns;
  - finals mode (school date sheet overrides the plan).

---

## 12. Onboarding & templates

The existing config importer becomes the onboarding engine.

1. **Who are you?** Student-builder / professional + startup / researcher / custom.
2. **Basics:** hours, sleep, school or work times, subjects or business areas.
3. **Starter template:** a ready-made plan with routines, goals, checklists, achievements and rewards.
4. **First good day:** a guided first day ending in one completed block and a short review.

**Plan import (unique):** Excel / CSV / syllabus PDF / pasted text / chat with AI → a full plan. This productises what was done by hand with the Master Study + Skills Plan (2,521 time slots → blocks, goals, milestones, tasks, checklists).

**Template gallery:** CBSE/JEE/NEET, SAT/AP, freelancer, indie founder, researcher, fitness. Later, a community marketplace.

**Also:** sample-data mode, empty states with a clear next step on every screen, and progressive disclosure (Simple → Advanced).

---

## 13. More features worth building

- **Calendar sync:** two-way Google / Outlook / iCal.
- **Focus:**
  - an app and site blocker during focus blocks (desktop);
  - focus sounds;
  - an honest focus score.
- **Energy & health:** sleep, mood and energy check-ins; Apple Health / Google Fit; energy-aware scheduling (deep work in the user's best hours).
- **Journal:** daily prompts, mood trends, gratitude.
- **Accountability:** share progress with a mentor or partner; study groups.
- **Integrations:**
  - GitHub (commits as skill evidence), LeetCode, TryHackMe;
  - Google Drive, Notion and Todoist importers;
  - Zapier/webhooks, plus the public API and MCP.
- **Native extras:** home-screen widgets, menu-bar/tray timer, Siri/Shortcuts; Watch / Wear OS later.
- **Navigation:** command palette, keyboard-first navigation, search across all records.
- **Burnout detection:** overload and burnout signals (a burnout service already exists — productise it).
- **Weekly catch-up slot:** a weekly catch-up slot as a first-class concept, so missed work always has a home.

---

## 14. Data, database & sync

- **On-device:** IndexedDB (Dexie) on web; SQLite in the native shells (Tauri / Capacitor). Keep the repository/adapter layer so the domain code doesn't care which one is used.
- **Schema hygiene:**
  - IDs that can't collide across devices (mostly true already);
  - `updatedAt` on every row;
  - soft deletes (tombstones);
  - versioned migrations, with an automatic local snapshot before each migration.
- **Sync (Pro):**
  - Options: a local-first sync engine (**PowerSync**, **ElectricSQL**, Replicache or Triplit), or Postgres plus a custom sync protocol.
  - Field-level conflict rules, end-to-end encrypted, with keys derived from a user passphrase plus a recovery key.
- **Attachments:** object storage (S3/R2), encrypted.
- **Backups:** export JSON / CSV / Markdown; encrypted cloud backups; one-click restore.
- **Fixes:** sync solves the separate iPad/PC data problem.

---

## 15. Accounts, login & data collection

- **Accounts are optional.** The app works fully without one; an account is required only for sync, hosted AI, billing and push.
- **Auth:** Supabase Auth or Clerk: passkeys, Google/Apple sign-in, email magic link.
- **Collect the minimum:**
  - email, plan/subscription state, device list;
  - **opt-in** anonymous product analytics (self-hosted PostHog);
  - crash reports (Sentry, with personal data scrubbed).
- **Never collected:** schedule, notes or business data, unless sync is on, and then only encrypted.
- **User rights:** export, delete account (deletion within 30 days, with confirmation), consent screens, a grievance contact.
- **Children:** under DPDP, users under 18 need verifiable parental consent → build a parental-consent flow (or restrict sign-ups to 18+ for accounts while keeping the local app open to all).

---

## 16. AI: three approaches

| Mode | How | Who |
|---|---|---|
| **Hosted** | Claude / GPT via our server proxy; metered credits in Pro | Most users |
| **Bring your own key** | The user pastes an Anthropic/OpenAI/OpenRouter key; calls go direct from the device | Power users, free tier |
| **Local** | Ollama / LM Studio on desktop; small on-device models later | Privacy-first users, offline |

- **Shared layer:** a provider abstraction in `packages/ai` (tool-calling loop, streaming, retries, prompt templates, evaluations).
- **Hosted controls:** usage metering per user, rate limits, spending caps, abuse protection.
- **External agents:** MCP stays available to Claude Desktop, Claude Code, Cursor, VS Code and other MCP clients. In the desktop app the MCP server is built in, so no browser tab is needed.

---

## 17. Subscriptions & pricing

| Tier | Includes | Indicative price |
|---|---|---|
| **Free** | Full local app, 1 device, all core features, BYOK and local AI, export | ₹0 |
| **Pro** | Encrypted sync across devices, hosted AI credits, notes and whiteboard sync, calendar sync, attachment storage, advanced analytics, premium templates, push notifications | ₹199–299 / month · $5–7 / month |
| **Student** | Pro at a discount (verified school email or ID) | ~50% off |
| **Team** (later) | Shared workspaces, roles, client collaboration, seat billing | per seat |
| **Founder / lifetime** | Optional early-supporter deal | one-off |

- **Gate:** sync, hosted AI, storage, integrations and team features.
- **Never gate:** the user's own data, export, or the local app.

**Billing**

- **Payments:** **Razorpay** (India: UPI, cards, GST invoices) and **Stripe** (international).
- **Entitlements:** a signed licence token verified offline with a grace period, so local-first keeps working without a server round trip.
- **Lifecycle:** trials, coupons, proration, dunning (failed-payment retries), refunds, a cancellation flow.
- **App stores:** iOS/Android in-app purchase rules (15–30% fee). Use RevenueCat for store purchases, and offer web checkout where store rules allow.
- **AI margin:** the biggest variable cost; price Pro so hosted AI stays profitable.

---

## 18. Open source model

- **Licence:** **AGPL-3.0** for the app and server (protects against closed hosted forks). Alternatively Apache-2.0 for maximum adoption. Libraries (`packages/core`, `agent-protocol`, `ui`) can be MIT/Apache to encourage reuse.
- **Business:** **open core + hosted services**: the code is open; Pro sells convenience (sync, hosted AI, storage, push, support). Self-hosting stays allowed.
- **Trademark:** the name and logo stay protected (trademark policy) even though the code is open.
- **Contributors:** a Contributor License Agreement (or DCO), so dual-licensing remains possible.
- **Repo files:** LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md (disclosure policy), GOVERNANCE, issue and PR templates, a public roadmap.
- **Dependencies:** a licence audit with no GPL-incompatible dependencies; a THIRD_PARTY_NOTICES file.

---

## 19. Native applications

| Platform | Tech | Why |
|---|---|---|
| Windows / macOS / Linux | **Tauri** (Rust) | Small installer (~10–15 MB). **Built-in agent server** (no browser tab), real OS notifications, tray timer, global hotkey, focus blocker, SQLite |
| iOS / iPadOS / Android | **Capacitor** (config already present) | Reuses the React code; native push (APNs/FCM) fixes iOS background reminders; home-screen widgets |
| Web | PWA (today) | Zero-install entry point |

Not React Native: it would mean a rewrite for little gain.

**Release needs:**

| Item | Cost / note |
|---|---|
| Apple Developer Program | $99 / year |
| Google Play | $25 once |
| Windows code-signing certificate | ~$100–300 / year |
| Auto-update | Tauri updater |
| Store listings, privacy labels, screenshots, review process | — |
| Play closed testing | 12 testers × 14 days for new personal accounts |

---

## 20. Repository restructure

Monorepo with **pnpm workspaces + Turborepo**:

```
apps/
  web/            React app (today's src/)
  desktop/        Tauri shell: built-in agent server, tray, notifications, focus blocker
  mobile/         Capacitor shell: iOS/Android, push, widgets
  server/         API: auth, sync, billing webhooks, AI proxy, push (Hono / Supabase functions)
  agent/          MCP server + CLI (today's agent/)
  landing/        marketing site, pricing, blog (Astro)
  docs/           user + developer docs site (Starlight / Docusaurus)
  admin/          internal: users, subscriptions, feature flags, support
packages/
  core/           domain logic: scheduling, XP, conditions, analytics (today's engines + services)
  db/             schema, migrations, sync adapters, fixtures
  ui/             design system: tokens, components, icons, Storybook
  agent-protocol/ operation catalog, schemas, OpenAPI (today's src/agent/catalog)
  ai/             LLM providers, tool loop, prompts, evaluations
  editor/         notes editor + whiteboard wrappers
  templates/      onboarding templates
  config/         shared tsconfig / eslint / prettier / vitest presets
```

**Engineering hygiene**

- **Feature boundaries:** feature folders by area (Plan / Do / Track / Work / Know); lint rules block cross-feature imports of internals.
- **Commits & releases:** conventional commits, Changesets, semver, auto CHANGELOG, beta/stable channels.
- **CI on every PR:** type-check, lint, unit tests, Playwright end-to-end, bundle-size budget, accessibility checks, preview deploy.
- **Supply chain:** Renovate, CodeQL, dependency audit, secret scanning, CODEOWNERS.
- **Decisions & config:** architecture decision records in `docs/adr/` (local-first, bridge, Tauri, sync engine); per-environment config (dev/staging/prod); no secrets in the repo.

---

## 21. Clean-up, debloat & duplicate removal

**Remove from the repo**

- Personal data: `config/lifeos-my-schedule.json`, personal achievements, scratch notes; `PROGRESS.md` moves to an internal changelog.
- Build artefacts committed by accident: `build.log`, `*.tsbuildinfo`, `dist/`.
- Stray root files (e.g. `tracker-hues.js`) moved into the right package.
- Defaults that only fit one user; personal setups become templates.

**Measure first**

- `knip` (unused files/exports), `depcheck` (unused dependencies), a bundle analyzer, `pygount` (lines of code per feature), coverage reports.

**Merge duplicate concepts**

| Today | Becomes |
|---|---|
| Habits + daily checklists + recurring blocks | One **Routine** model |
| Goals + projects + studies + exam tracks (each creating "backing goals") | One **Goal** base with variants |
| Revision engine + recurring tasks | Tasks + a revision **generator** |
| Achievements + rewards + XP + currency | XP + achievements core; rewards optional |
| Simple/Advanced modes + many settings | Fewer settings, better defaults |
| Animated galaxy background (vendored) | Optional, lazy-loaded, respects reduced motion |

Already unified: one notification engine; one agent operation catalog; one block-completion path.

**Lightweight budgets**

| Budget | Target |
|---|---|
| Initial JavaScript | < 250 KB gzip |
| Time to interactive (mid-range phone) | < 1.5 s |
| Desktop installer | < 15 MB |

- Lazy-load the PDF viewer, charts, editor, whiteboard, analytics and background.
- Delete code with zero callers. Cut or simplify the least-used 20% once analytics exist.

---

## 22. Quality, security & reliability

**Testing**

- Keep and grow unit tests (537 today).
- Playwright end-to-end: onboarding → plan a day → complete a block → review; invoice → payment; two-device sync.
- Visual regression, accessibility (axe), and load tests (100k records).
- Time-zone, daylight-saving, midnight-crossing and leap-day tests.

**Sync tests:** offline → online, clock skew, conflicting edits, interrupted migration.

**Security**

- Content-Security-Policy; encrypted local storage where possible; end-to-end encrypted sync.
- Agent token rotation, rate limits, input size limits.
- Dependency scanning; a pen test before the paid launch; `security.txt` and a disclosure policy.

**AI safety:** confirmations for destructive actions, spending caps, prompt-injection tests.

**Reliability**

- Snapshot before every migration; one-click restore.
- Server backups with tested restores.
- Feature flags and kill switches; staged mobile rollouts.

**Support:** in-app feedback and bug report (optional diagnostics export), help centre, public changelog and roadmap.

---

## 23. Accessibility & localisation

- **Accessibility:** WCAG 2.2 AA, full keyboard use, screen-reader labels, reduced motion, high contrast, adjustable text size.
- **Localisation:** i18n framework (i18next) from day one; English first, Hindi next. Local date and number formats, ₹ and other currencies, week-start setting.
- **Devices:** phone, tablet, desktop, ultrawide; light and dark themes.

---

## 24. Backend & operations

| Need | Choice |
|---|---|
| Auth | Supabase Auth / Clerk |
| Database | Postgres (Supabase / Neon) |
| Sync | PowerSync / ElectricSQL (or custom) |
| Files | S3-compatible (Cloudflare R2) |
| AI proxy | Our server; metering + rate limits |
| Push | APNs + FCM |
| Email | Resend / Postmark (receipts, magic links, weekly summary) |
| Monitoring | Sentry, PostHog (opt-in), uptime checks, status page |
| Admin | Internal admin app: users, subscriptions, refunds, flags, support |
| Ops | Backups, incident runbook, on-call alerts |

---

## 25. Legal & business

**Account holder (decided: Aksh).** Stripe, Razorpay, the Apple Developer Program and Google Play require the legal account holder to be an adult (18+) or a registered business, and the payout bank account must match. If Aksh is under 18 when launching, a parent or guardian must be the legal holder (with Aksh operating the accounts), or the accounts are opened once he turns 18 or through a registered company.

**Business setup**

- Sole proprietorship to start; a private limited company if raising money or growing.
- GST registration (mandatory above the threshold, and needed for GST invoices); business bank account; Razorpay/Stripe KYC.
- The trademark is filed in the owner's (or company's) name.

**Policies & compliance**

- **Policies:** terms of service, privacy policy, refund policy, cookie notice, AI acceptable-use policy.
- **India DPDP Act 2023:**
  - consent notices, purpose limitation, deletion on request, a grievance officer contact;
  - **verifiable parental consent for users under 18** — critical because the core audience is students.
- **Other privacy:** GDPR for EU users; App Store privacy labels; Play data-safety form.
- **Open source compliance:** licence obligations and third-party notices.
- **AI:** follow model-provider usage policies; never train on user data; disclose AI use clearly.

---

## 26. Go-to-market

**Positioning:** *"The planner your AI can run — for students who study and build. Private, offline, honest progress."*

**Launch sequence**

1. Private beta: 20–50 student-builders (own school, Discord study servers, r/SAT, r/JEE, Indian dev and founder communities).
2. Public beta with Pro.
3. Product Hunt, Hacker News ("Show HN: an MCP-native planner"), indie-hacker communities, GitHub trending (open source helps).

**Landing page:** a demo video of the agent planning a week from a spreadsheet, pricing, comparison with Notion / Todoist / Motion, privacy section, waitlist.

**Content**

- Free study-plan templates (SEO).
- Build-in-public posts ("how I plan 16 hours a day while studying and building").
- Short videos of the agent doing real work.

**Growth loops**

- Shareable templates and progress cards.
- Referral credit (a free Pro month).
- Template marketplace where creators earn.
- Open-source contributors.

**Retention:** a "first good day" in onboarding, a weekly review email, honest streaks, win-back emails.

---

## 27. What to postpone

Not before there are paying users:

- Teams and real-time collaboration
- Client portal
- Email sync
- Smartwatch apps
- Template marketplace
- Community features
- A full HubSpot-class CRM
- Enterprise features

Build "excellent for one operator" versions first.

---

## 28. Costs

| Item | Cost |
|---|---|
| Hosting, sync, email, monitoring, domain (early stage) | ~₹3–10k / month (≈ $40–120) |
| Hosted AI | Variable; metered and covered by Pro (BYOK/local cost nothing) |
| Apple Developer | $99 / year |
| Google Play | $25 once |
| Windows code signing | ~$100–300 / year |
| Trademark filing (India, per class) | ~₹4.5–10k + attorney fees |
| Pen test (before paid launch) | varies |

**Effort:** the full scope is a 3–6 person team-year. Solo with AI assistance, expect **9–18 months to a solid paid v1**, with hard scope cuts.

---

## 29. Roadmap

### Phase 0 — Foundation (3–5 weeks)

- Rename (clearance + domain); add the LICENSE and community files.
- Monorepo restructure; CI; remove personal data and artefacts.
- Debloat pass (knip / depcheck / bundle); merge duplicate models (Routine, Goal base).
- Design-system tidy-up; docs site skeleton; ADRs.

### Phase 1 — Standalone product (6–8 weeks)

- Onboarding + templates + plan import (Excel/CSV/AI).
- Notes v1, whiteboard v1 (Excalidraw).
- Agentic Home with BYOK and local AI, on the existing tool catalog, with preview → apply.
- Tauri desktop app: built-in agent server, OS notifications, tray, focus blocker.
- Private beta (free).

### Phase 2 — Accounts & money (6–8 weeks)

- Auth, encrypted sync, entitlements.
- Razorpay + Stripe; hosted AI with metering.
- Landing page, pricing, legal pages, analytics/crash reporting (opt-in).
- Public beta with Pro.

### Phase 3 — Mobile (6–8 weeks)

- Capacitor iOS/Android, push notifications, widgets.
- Store submissions (privacy labels, Play closed test).

### Phase 4 — Work & Know (8+ weeks)

- Full CRM and PMS views, PDF/GST invoicing, recurring invoices.
- Know module: citations, flashcards, exam mode polish.
- Google/Outlook calendar sync.

### Phase 5 — Growth

- Integrations (GitHub, LeetCode, TryHackMe, importers, webhooks).
- Template marketplace; Teams tier; Hindi localisation.

---

## 30. Metrics

| Metric | Definition |
|---|---|
| Activation | Planned a day **and** completed ≥ 1 block within 48 h of install |
| Retention | D1 / D7 / D30 active users |
| Weekly active planners | Users who completed blocks on ≥ 3 days in a week |
| Conversion | Free → Pro |
| Churn | Monthly Pro cancellations |
| AI cost per user | Hosted AI spend ÷ Pro users (must stay well under price) |
| Agent success rate | % of agent requests applied without user correction |
| Performance | Time to interactive; crash-free sessions |

---

## 31. Open questions

1. **Final name:** pick from the candidates (or new ones) and run full clearance (§3).
2. **Licence choice:** AGPL-3.0 vs Apache-2.0 for the app.
3. **Sync engine:** PowerSync vs ElectricSQL vs custom (spike both in Phase 2).
4. **Legal holder for payments and stores** if under 18 at launch (§25).
5. **Pricing validation:** interview 10–20 target users before setting final prices.
6. **Parental consent flow vs 18+ accounts** for the student audience (DPDP).
