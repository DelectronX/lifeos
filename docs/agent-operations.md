# LifeOS agent operations

Generated from `src/agent/catalog.ts` by `node scripts/gen-agent-docs.mjs` — 121 operations.
Each is an MCP tool (same name), a REST endpoint `POST /api/v1/ops/<name>` (reads also `GET`), and `lifeos-agent call <name>`.

Kinds: **read** (never changes data) · **write** (changes data; needs permission "Read & edit") · **destructive** (deletes; needs "Full" and `"confirm": true`).

## Error codes

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | Input did not match the operation schema. |
| `NOT_FOUND` | The referenced record does not exist. |
| `CONFLICT` | The record changed since you read it (expectedUpdatedAt mismatch), or the change conflicts with its state. |
| `INVALID_STATE` | The record is in a state that does not allow this operation. |
| `CONFIRMATION_REQUIRED` | Destructive operation called without confirm: true. |
| `PERMISSION_DENIED` | The agent permission level does not allow this operation. |
| `UNKNOWN_OPERATION` | No operation with that name. |
| `APP_NOT_CONNECTED` | No LifeOS window is connected to the agent server. Open LifeOS and enable Agent access in Settings. |
| `TIMEOUT` | The app did not answer in time. |
| `UNAUTHORIZED` | Missing or wrong bearer token. |
| `INTERNAL_ERROR` | Unexpected failure inside the app. |

## Contents

- [overview](#overview)
- [schedule](#schedule)
- [recurring](#recurring)
- [planning](#planning)
- [tasks](#tasks)
- [checklists](#checklists)
- [goals](#goals)
- [progress](#progress)
- [projects](#projects)
- [skills](#skills)
- [earning](#earning)
- [research](#research)
- [exams](#exams)
- [habits](#habits)
- [focus](#focus)
- [analytics](#analytics)
- [settings](#settings)
- [system](#system)

## overview

### `dashboard_get` — Dashboard

read · idempotent

Everything on the Home dashboard for a day: completion of required blocks / tasks / checklist items, the current and next block, overdue and upcoming tasks, streak, level and XP, focus time, recent achievements. Start here to understand the user's day.

| Field | Type | Notes |
|---|---|---|
| `date` | date | Day to summarise; defaults to today. Format YYYY-MM-DD. |

### `progress_get` — Progress for a period

read · idempotent

Daily, weekly or monthly progress: required blocks completed, tasks completed, checklist completion, tracked minutes, XP earned, per-day series.

| Field | Type | Notes |
|---|---|---|
| `period` **(required)** | `day` \| `week` \| `month` | Period type. |
| `date` | date | Any day inside the period; defaults to today. Format YYYY-MM-DD. |

## schedule

### `schedule_get_day` — Schedule for a day

read · idempotent

All schedule blocks on one day in time order, with status, tracker, linked task/goal, and timing. Use for "today's schedule".

| Field | Type | Notes |
|---|---|---|
| `date` | date | Defaults to today. Format YYYY-MM-DD. |
| `includeCancelled` | boolean | Include cancelled blocks. |

### `schedule_list_blocks` — List blocks in a range

read · idempotent

Blocks between two dates (inclusive), filterable by status / tracker / kind, paginated and sorted by start time. Use for week or month views.

| Field | Type | Notes |
|---|---|---|
| `from` **(required)** | date | First day. Format YYYY-MM-DD. |
| `to` **(required)** | date | Last day (max 93 days after `from`). Format YYYY-MM-DD. |
| `status` | enum[] | Only these statuses. |
| `trackerId` | string | ID of the tracker. |
| `kind` | enum[] |  |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `schedule_get_block` — Get a block

read · idempotent

One block by ID, with its conflicts on the same day.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the block. |

### `schedule_get_current` — Current and next block

read · idempotent

The block happening now (if any) and the next planned block.

_No input._

### `schedule_create_block` — Create a block

write

Adds a block to the calendar. Returns the block and any overlapping blocks (conflicts are reported, not prevented).

| Field | Type | Notes |
|---|---|---|
| `title` **(required)** | string | Title. |
| `start` **(required)** | date-time | Start. ISO 8601; without an offset it is read as LOCAL time (e.g. 2026-11-19T14:30). |
| `end` **(required)** | date-time | End (after start). ISO 8601; without an offset it is read as LOCAL time (e.g. 2026-11-19T14:30). |
| `trackerId` **(required)** | string | ID of the tracker (area/subject); see trackers_list. |
| `kind` | `task` \| `fixed` \| `break` \| `buffer` \| `sleep` \| `meal` \| `event` | Block kind; default "task" when taskId is set, else "fixed". |
| `taskId` | string | ID of the task to work on. |
| `goalId` | string | ID of the goal. |
| `notes` | string | Notes. |
| `protected` | boolean | Protected blocks are never moved by auto-plan. |
| `locked` | boolean | Locked blocks cannot be dragged. |
| `optional` | boolean | Optional blocks (free time, optional extras) never count as missed and earn no productivity XP. |

### `schedule_update_block` — Update a block

write · idempotent

Edits a block's details (not its time — use schedule_reschedule_block). Supports optimistic concurrency.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the block. |
| `title` | string | Title. |
| `notes` | string | Notes. |
| `trackerId` | string | ID of the tracker. |
| `kind` | `task` \| `fixed` \| `break` \| `buffer` \| `sleep` \| `meal` \| `event` |  |
| `protected` | boolean |  |
| `locked` | boolean |  |
| `taskId` | string \| null | Link a task (null to unlink). |
| `goalId` | string \| null | Link a goal (null to unlink). |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `schedule_reschedule_block` — Reschedule a block

write · idempotent

Moves a block to a new start/end (any day). Locked blocks are refused. Returns conflicts at the new time.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the block. |
| `start` **(required)** | date-time | New start. ISO 8601; without an offset it is read as LOCAL time (e.g. 2026-11-19T14:30). |
| `end` | date-time | New end; defaults to keeping the same duration. ISO 8601; without an offset it is read as LOCAL time (e.g. 2026-11-19T14:30). |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `schedule_complete_block` — Complete a block

write · idempotent

Marks a block completed through the same single completion path as the app's Done button: logs the real elapsed time, awards XP once, updates streaks, bonuses and the linked task. Idempotent — completing twice returns status "already_completed".

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the block. |
| `trackerId` | string | ID of the more specific sub-tracker actually worked on (e.g. a subject under Academics). |
| `units` | number | Countable output (e.g. problems solved) when the tracker has a unit. |

### `schedule_reopen_block` — Mark a block incomplete

write · idempotent

Reverts a completed or skipped block to planned and removes the XP / events its completion produced.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the block. |

### `schedule_start_block` — Start a block

write · idempotent

Marks a block in progress now. A started block is auto-completed at its planned end (see schedule_run_auto_completion).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the block. |

### `schedule_skip_block` — Skip a block

write · idempotent

Marks a block skipped (no XP).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the block. |
| `reason` | string | Why. |

### `schedule_cancel_block` — Cancel a block

write · idempotent

Marks a block cancelled (kept for history, excluded from stats).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the block. |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `schedule_delete_block` — Delete a block

destructive · idempotent

Permanently deletes a block. Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the block. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

### `schedule_get_conflicts` — Schedule conflicts

read · idempotent

Pairs of overlapping (non-cancelled) blocks on each day in a range.

| Field | Type | Notes |
|---|---|---|
| `from` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `to` | date | Defaults to `from`. Format YYYY-MM-DD. |

### `schedule_completion_history` — Completion history

read · idempotent

Block completions and skips (the real logged events) in a date range, newest first, with durations.

| Field | Type | Notes |
|---|---|---|
| `from` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `to` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `trackerId` | string | ID of the tracker. |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `schedule_run_auto_completion` — Run automatic completion

write · idempotent

Settles every started block whose planned end has passed, through the same completion path. Blocks never started are left alone. Idempotent; returns how many were completed.

_No input._

### `schedule_auto_completion_status` — Automatic completion status

read · idempotent

Started blocks that will auto-complete, and those already past their end awaiting the next settle.

_No input._

## recurring

### `recurring_list` — Recurring schedules

read · idempotent

Every recurring rule (repeating blocks or tasks) with a human-readable description.

| Field | Type | Notes |
|---|---|---|
| `activeOnly` | boolean | Only active rules. |

### `recurring_create` — Create a recurring block

write

Creates a repeating block (daily / weekly on given weekdays / monthly on given days) and generates its upcoming occurrences.

| Field | Type | Notes |
|---|---|---|
| `title` **(required)** | string | Title. |
| `freq` **(required)** | `daily` \| `weekly` \| `monthly` |  |
| `interval` | integer | Every N periods. |
| `byWeekday` | integer[] | Weekly: 0=Sunday … 6=Saturday. |
| `byMonthDay` | integer[] | Monthly: days of month. |
| `startDate` | date | First possible date; defaults to today. Format YYYY-MM-DD. |
| `endDate` | string \| null | Last date (null = no end). Format YYYY-MM-DD. |
| `startTime` **(required)** | time | Start time. 24h HH:MM. |
| `durationMinutes` **(required)** | integer | Length. |
| `trackerId` **(required)** | string | ID of the tracker. |
| `kind` | `task` \| `fixed` \| `break` \| `buffer` \| `sleep` \| `meal` \| `event` |  |
| `protected` | boolean |  |
| `notes` | string |  |

### `recurring_edit` — Edit a recurring series

write · idempotent

Edits one occurrence, this-and-future, or the whole series (like a calendar app).

| Field | Type | Notes |
|---|---|---|
| `ruleId` **(required)** | string | ID of the recurring rule. |
| `occurrenceDate` **(required)** | date | The occurrence being edited. Format YYYY-MM-DD. |
| `scope` **(required)** | `occurrence` \| `future` \| `series` |  |
| `title` | string | Title. |
| `startTime` | time | Local time of day. 24h HH:MM. |
| `durationMinutes` | integer |  |
| `trackerId` | string | ID of the tracker. |
| `kind` | `task` \| `fixed` \| `break` \| `buffer` \| `sleep` \| `meal` \| `event` |  |
| `protected` | boolean |  |
| `notes` | string |  |

### `recurring_set_active` — Pause / resume a recurring rule

write · idempotent

Activates or pauses a recurring rule.

| Field | Type | Notes |
|---|---|---|
| `ruleId` **(required)** | string | ID of the recurring rule. |
| `active` **(required)** | boolean |  |

### `recurring_delete` — Delete occurrences / series

destructive · idempotent

Deletes one occurrence, this-and-future, or the whole series. Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `ruleId` **(required)** | string | ID of the recurring rule. |
| `occurrenceDate` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `scope` **(required)** | `occurrence` \| `future` \| `series` |  |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

## planning

### `plan_preview` — Preview auto-plan

read · idempotent

Runs the rule-based Auto Plan for one or more days WITHOUT saving: proposed blocks for open tasks, unplaced tasks and why.

| Field | Type | Notes |
|---|---|---|
| `from` | date | Defaults to today. Format YYYY-MM-DD. |
| `days` | integer | Days to plan. |
| `taskIds` | string[] | Only these tasks. |
| `regenerate` | boolean | Replace this range's previous auto-planned (unlocked, still planned) blocks instead of only filling gaps. |

### `plan_apply` — Apply auto-plan

write

Runs Auto Plan and saves the proposed blocks (optionally only some). Undo with plan_undo_last.

| Field | Type | Notes |
|---|---|---|
| `from` | date | Local calendar date. Format YYYY-MM-DD. |
| `days` | integer |  |
| `taskIds` | string[] |  |
| `regenerate` | boolean |  |
| `acceptTaskIds` | string[] | Only save proposals for these tasks. |

### `plan_undo_last` — Undo last plan

write

Reverts the most recent undoable Auto Plan / reschedule run.

_No input._

## tasks

### `tasks_list` — List tasks

read · idempotent

Tasks filtered by status, due-date range, tracker, goal, tag or text; sorted and paginated.

| Field | Type | Notes |
|---|---|---|
| `status` | enum[] |  |
| `dueFrom` | date | Local calendar date. Format YYYY-MM-DD. |
| `dueTo` | date | Local calendar date. Format YYYY-MM-DD. |
| `trackerId` | string | ID of the tracker. |
| `goalId` | string | ID of the goal. |
| `tag` | string |  |
| `search` | string | Text in title/notes. |
| `sort` | `dueDate` \| `priority` \| `createdAt` \| `updatedAt` \| `title` | Sort key (default dueDate). |
| `order` | `asc` \| `desc` |  |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `tasks_get` — Get a task

read · idempotent

One task with its scheduled blocks and history.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the task. |

### `tasks_overdue` — Overdue tasks

read · idempotent

Open tasks whose due date has passed, most overdue first.

| Field | Type | Notes |
|---|---|---|
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `tasks_upcoming` — Upcoming tasks

read · idempotent

Open tasks due in the next N days (default 7), soonest first.

| Field | Type | Notes |
|---|---|---|
| `days` | integer |  |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `tasks_create` — Create a task

write

Creates a task.

| Field | Type | Notes |
|---|---|---|
| `title` **(required)** | string | Title. |
| `trackerId` **(required)** | string | ID of the tracker; see trackers_list. |
| `notes` | string |  |
| `dueDate` | string \| null | Due date. Format YYYY-MM-DD. |
| `deadlineHard` | boolean | A hard deadline cannot slip. |
| `basePriority` | integer | 1 (lowest) – 5 (highest). |
| `estimatedMinutes` | integer |  |
| `type` | `study` \| `practice` \| `revision` \| `reading` \| `writing` \| `workout` \| `project` \| `admin` \| `chore` \| `other` |  |
| `goalId` | string | ID of the goal. |
| `milestoneId` | string | ID of the milestone. |
| `tags` | string[] | Free-form tags. |
| `preferredWindow` | `morning` \| `afternoon` \| `evening` \| `night` \| `any` |  |
| `intensity` | `low` \| `medium` \| `high` |  |
| `flexibility` | `fixed` \| `movable` \| `flexible` |  |
| `status` | `inbox` \| `planned` |  |

### `tasks_update` — Update a task

write · idempotent

Edits task fields (use tasks_set_status to change status). Optimistic concurrency via expectedUpdatedAt.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the task. |
| `title` | string | Title. |
| `notes` | string |  |
| `dueDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `deadlineHard` | boolean |  |
| `basePriority` | integer | 1 (lowest) – 5 (highest). |
| `estimatedMinutes` | integer |  |
| `type` | `study` \| `practice` \| `revision` \| `reading` \| `writing` \| `workout` \| `project` \| `admin` \| `chore` \| `other` |  |
| `trackerId` | string | ID of the tracker. |
| `goalId` | string \| null |  |
| `milestoneId` | string \| null |  |
| `tags` | string[] | Free-form tags. |
| `preferredWindow` | `morning` \| `afternoon` \| `evening` \| `night` \| `any` |  |
| `intensity` | `low` \| `medium` \| `high` |  |
| `flexibility` | `fixed` \| `movable` \| `flexible` |  |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `tasks_set_status` — Set task status

write · idempotent

Changes a task's status through the app's transition rules (completing awards XP once).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the task. |
| `status` **(required)** | `inbox` \| `planned` \| `in_progress` \| `completed` \| `skipped` \| `rescheduled` \| `cancelled` |  |
| `reason` | string |  |
| `actualMinutes` | integer | Time actually spent, when completing. |

### `tasks_reschedule` — Reschedule a task

write · idempotent

Moves a task's due date (logged as a reschedule).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the task. |
| `dueDate` **(required)** | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `reason` | string |  |

### `tasks_schedule_at` — Put a task on the calendar

write

Creates a block for a task at a given time.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the task. |
| `start` **(required)** | date-time | Date-time. ISO 8601; without an offset it is read as LOCAL time (e.g. 2026-11-19T14:30). |
| `minutes` | integer | Length; defaults to the remaining estimate. |

### `tasks_delete` — Delete a task

destructive · idempotent

Permanently deletes a task (and its XP). Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the task. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

## checklists

### `checklists_list` — Checklists

read · idempotent

Daily / weekly / monthly checklists with items and the completion state for the period containing `date`.

| Field | Type | Notes |
|---|---|---|
| `cadence` | `daily` \| `weekly` \| `monthly` |  |
| `date` | date | Defaults to today. Format YYYY-MM-DD. |
| `includeInactive` | boolean |  |

### `checklists_create` — Create a checklist

write

Creates a recurring checklist.

| Field | Type | Notes |
|---|---|---|
| `title` **(required)** | string | Title. |
| `cadence` **(required)** | `daily` \| `weekly` \| `monthly` |  |
| `description` | string |  |
| `items` | object[] | Items. |
| `completionXP` | integer |  |
| `trackerId` | string | ID of the tracker. |

### `checklists_update` — Update a checklist

write · idempotent

Edits title, description, cadence-independent fields or active state.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the checklist. |
| `title` | string | Title. |
| `description` | string |  |
| `active` | boolean |  |
| `completionXP` | integer |  |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `checklists_add_item` — Add a checklist item

write

Adds an item.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the checklist. |
| `title` **(required)** | string | Title. |
| `doneDefinition` | string |  |
| `timing` | string |  |

### `checklists_remove_item` — Remove a checklist item

destructive · idempotent

Removes an item from the template. Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the checklist. |
| `itemId` **(required)** | string | ID of the item. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

### `checklists_set_item` — Check / uncheck an item

write · idempotent

Sets an item checked or unchecked for the period containing `date`. Idempotent: setting the current state is a no-op.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the checklist. |
| `itemId` **(required)** | string | ID of the item. |
| `checked` **(required)** | boolean |  |
| `date` | date | Defaults to today. Format YYYY-MM-DD. |

### `checklists_delete` — Delete a checklist

destructive · idempotent

Deletes a checklist and its history. Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the checklist. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

## goals

### `goals_list` — Goals

read · idempotent

Goals with progress (0–1), milestones and status.

| Field | Type | Notes |
|---|---|---|
| `status` | enum[] |  |
| `trackerId` | string | ID of the tracker. |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `goals_get` — Get a goal

read · idempotent

A goal with progress, milestones, linked tasks and recent history.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the goal. |

### `goals_history` — Goal history

read · idempotent

Logged events for a goal (completions, milestones, time), newest first.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the goal. |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `goals_create` — Create a goal

write

Creates a goal; optionally with milestone titles.

| Field | Type | Notes |
|---|---|---|
| `title` **(required)** | string | Title. |
| `type` **(required)** | `completion` \| `metric` \| `time` \| `milestone` \| `habit` |  |
| `trackerId` **(required)** | string | ID of the tracker. |
| `description` | string |  |
| `targetDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `targetValue` | number \| null |  |
| `unit` | string |  |
| `color` | `indigo` \| `teal` \| `amber` \| `rose` \| `violet` \| `slate` \| `sky` \| `lime` \| `stone` |  |
| `milestones` | string[] | Milestone titles, in order. |

### `goals_update` — Update a goal

write · idempotent

Edits a goal, including status (active / paused / completed / abandoned).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the goal. |
| `title` | string | Title. |
| `description` | string |  |
| `status` | `active` \| `paused` \| `completed` \| `abandoned` |  |
| `targetDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `targetValue` | number \| null |  |
| `unit` | string |  |
| `color` | `indigo` \| `teal` \| `amber` \| `rose` \| `violet` \| `slate` \| `sky` \| `lime` \| `stone` |  |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `goals_delete` — Delete a goal

destructive · idempotent

Deletes a goal and its milestones (tasks are kept, unlinked). Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the goal. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

### `milestones_create` — Add a milestone

write

Adds a milestone to a goal.

| Field | Type | Notes |
|---|---|---|
| `goalId` **(required)** | string | ID of the goal. |
| `title` **(required)** | string | Title. |
| `targetDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `weight` | number |  |

### `milestones_update` — Update a milestone

write · idempotent

Edits a milestone.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the milestone. |
| `title` | string | Title. |
| `targetDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `weight` | number |  |

### `milestones_set_done` — Complete / reopen a milestone

write · idempotent

Sets a milestone done or not done (banks or revokes its XP). Idempotent.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the milestone. |
| `done` **(required)** | boolean |  |

### `milestones_delete` — Delete a milestone

destructive · idempotent

Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the milestone. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

## progress

### `achievements_list` — Achievements

read · idempotent

Every achievement with live progress and unlock date.

| Field | Type | Notes |
|---|---|---|
| `unlocked` | boolean | Only unlocked (true) / locked (false). |
| `category` | string |  |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `xp_get` — Level & XP

read · idempotent

Level, XP to next level, streak, and recent XP transactions.

| Field | Type | Notes |
|---|---|---|
| `recent` | integer |  |

### `rewards_list` — Rewards

read · idempotent

Rewards with their conditions / costs, current balance and earnings.

_No input._

### `rewards_redeem` — Redeem a reward

write

Spends reward currency on a redeemable reward.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the reward. |

### `achievements_create` — Create / redefine an achievement

write · idempotent

Creates a custom achievement, or redefines one with the same key (its progress and unlock state are kept). It unlocks only from real activity, measured by `condition`: a condition tree whose leaves are { id, type: "leaf", metric, operator: ">=", value, window: { kind: "all_time" } } and whose groups are { id, type: "and"|"or", children }. Metrics include minutes:<trackerIds>, sessions:<trackerIds>, days:<trackerIds>, streak:<trackerIds>, units:<trackerIds>, goals:<trackerIds>, allDays:<a,b>, sameWeek:<a,b>, windowDays:<fromMin-toMin>, perfectDays, perfectWeeks, scheduleStreak, comebacks, totalXP, longestStreak, reviews:daily|weekly, checklists:daily|weekly|monthly|*, events:<activityType>, earned:*, papers:*. See achievements_list for existing keys.

| Field | Type | Notes |
|---|---|---|
| `key` **(required)** | string | Stable key (a-z, 0-9, _). |
| `title` **(required)** | string | Title. |
| `description` **(required)** | string |  |
| `category` **(required)** | `study` \| `goals` \| `skills` \| `consistency` \| `fitness` \| `mastery` \| `revision` \| `focus` \| `planning` \| `personal` \| `academic` \| `projects` \| `discipline` \| `meta` \| `research` \| `earning` |  |
| `target` **(required)** | number | Target value shown on the progress bar. |
| `xpReward` **(required)** | integer | XP awarded once on unlock. |
| `tier` | `1` \| `2` \| `3` |  |
| `unit` | string | Unit label, e.g. "minutes". |
| `condition` **(required)** | object | Condition tree (see description). |

### `rewards_create` — Create a reward

write

Creates a reward. kind "redeemable": a treat bought with reward currency (earned 1:1 from XP by default) at `cost`. kind "condition": earned automatically when `condition` (same tree format as achievements_create) is met, `repeat` times.

| Field | Type | Notes |
|---|---|---|
| `name` **(required)** | string | Title. |
| `description` | string |  |
| `kind` | `redeemable` \| `condition` |  |
| `cost` | integer | Price for redeemable rewards. |
| `treat` | string |  |
| `xpValue` | integer |  |
| `repeat` | `once` \| `daily` \| `weekly` \| `monthly` |  |
| `condition` | object |  |

## projects

### `projects_list` — Projects

read · idempotent

Projects with status, health and progress.

| Field | Type | Notes |
|---|---|---|
| `status` | enum[] |  |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `projects_get` — Get a project

read · idempotent

A project with milestones, tasks, deliverables, progress and recent history.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the project. |

### `projects_create` — Create a project

write

Creates a project (and its backing goal).

| Field | Type | Notes |
|---|---|---|
| `title` **(required)** | string | Title. |
| `summary` | string |  |
| `kind` | `portfolio` \| `client` \| `app` \| `research` \| `course` \| `personal` |  |
| `status` | `idea` \| `planning` \| `active` \| `testing` \| `shipped` \| `paused` \| `archived` |  |
| `trackerId` | string | ID of the tracker. |
| `startDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `targetDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `definitionOfDone` | string |  |
| `milestones` | string[] |  |
| `deliverables` | string[] |  |
| `repoUrl` | string |  |
| `demoUrl` | string |  |

### `projects_update` — Update a project

write · idempotent

Edits a project, including its status (shipping logs an event).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the project. |
| `title` | string | Title. |
| `summary` | string |  |
| `kind` | `portfolio` \| `client` \| `app` \| `research` \| `course` \| `personal` |  |
| `status` | `idea` \| `planning` \| `active` \| `testing` \| `shipped` \| `paused` \| `archived` |  |
| `startDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `targetDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `definitionOfDone` | string |  |
| `repoUrl` | string |  |
| `demoUrl` | string |  |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `projects_add_task` — Add a project task

write

Adds a task to a project (optionally under a milestone).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the project. |
| `title` **(required)** | string | Title. |
| `milestoneId` | string | ID of the milestone. |
| `estimatedMinutes` | integer |  |
| `dueDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |

### `projects_add_deliverable` — Add a deliverable

write

Adds a deliverable.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the project. |
| `title` **(required)** | string | Title. |

### `projects_set_deliverable` — Tick a deliverable

write · idempotent

Sets a deliverable done or not done. Idempotent.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the project. |
| `deliverableId` **(required)** | string | ID of the deliverable. |
| `done` **(required)** | boolean |  |

### `projects_delete` — Delete a project

destructive · idempotent

Deletes a project. Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the project. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

## skills

### `skills_list` — Skills

read · idempotent

Skills with level, target, gap, learning path and evidence.

| Field | Type | Notes |
|---|---|---|
| `category` | string |  |

### `skills_create` — Create a skill

write

Adds a skill.

| Field | Type | Notes |
|---|---|---|
| `name` **(required)** | string | Title. |
| `category` | string |  |
| `level` | integer |  |
| `targetLevel` | integer |  |
| `trackerId` | string | ID of the tracker. |
| `notes` | string |  |

### `skills_update` — Update a skill

write · idempotent

Edits a skill.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the skill. |
| `name` | string | Title. |
| `category` | string |  |
| `targetLevel` | integer |  |
| `notes` | string |  |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `skills_set_level` — Set skill level

write · idempotent

Sets the current level (0–5).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the skill. |
| `level` **(required)** | integer |  |

### `skills_add_evidence` — Add skill evidence

write

Records proof of a skill (lab, write-up, project, certificate).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the skill. |
| `title` **(required)** | string | Title. |
| `kind` **(required)** | `lab` \| `project` \| `course` \| `certificate` \| `problem_set` \| `writeup` \| `assessment` \| `other` |  |
| `date` | date | Local calendar date. Format YYYY-MM-DD. |
| `url` | string |  |
| `note` | string |  |

### `skills_add_path_item` — Add a learning-path step

write

Adds a step to the learning path.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the skill. |
| `title` **(required)** | string | Title. |

### `skills_set_path_item` — Tick a learning-path step

write · idempotent

Sets a learning-path step done / not done. Idempotent.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the skill. |
| `itemId` **(required)** | string | ID of the path item. |
| `done` **(required)** | boolean |  |

### `skills_delete` — Delete a skill

destructive · idempotent

Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the skill. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

## earning

### `earning_summary` — Earning summary

read · idempotent

Revenue, expenses, profit, outstanding invoices, pipeline and per-month figures for a date range.

| Field | Type | Notes |
|---|---|---|
| `from` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `to` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `currency` | string | ISO code; defaults to the app currency. |

### `contacts_list` — Clients & leads

read · idempotent

Contacts (leads, prospects, clients) with stage, deal value and next follow-up.

| Field | Type | Notes |
|---|---|---|
| `stage` | enum[] |  |
| `followUpDue` | boolean | Only those with a follow-up due today or earlier. |
| `search` | string |  |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `contacts_create` — Add a contact / lead

write

Creates a contact.

| Field | Type | Notes |
|---|---|---|
| `name` **(required)** | string | Title. |
| `company` | string |  |
| `email` | string |  |
| `phone` | string |  |
| `website` | string |  |
| `source` | string |  |
| `stage` | `lead` \| `contacted` \| `qualified` \| `proposal` \| `negotiation` \| `won` \| `lost` \| `client` |  |
| `dealValue` | number |  |
| `service` | string |  |
| `nextFollowUp` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `tags` | string[] | Free-form tags. |
| `notes` | string |  |

### `contacts_update` — Update a contact

write · idempotent

Edits a contact (use contacts_set_stage for pipeline moves).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the contact. |
| `name` | string | Title. |
| `company` | string |  |
| `email` | string |  |
| `phone` | string |  |
| `website` | string |  |
| `source` | string |  |
| `dealValue` | number |  |
| `service` | string |  |
| `nextFollowUp` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `tags` | string[] | Free-form tags. |
| `notes` | string |  |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `contacts_set_stage` — Move in pipeline

write · idempotent

Moves a contact to a pipeline stage (logged).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the contact. |
| `stage` **(required)** | `lead` \| `contacted` \| `qualified` \| `proposal` \| `negotiation` \| `won` \| `lost` \| `client` |  |
| `note` | string |  |

### `contacts_log_interaction` — Log an interaction

write

Records a call / email / meeting / proposal and optionally the next follow-up.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the contact. |
| `kind` **(required)** | `note` \| `call` \| `email` \| `message` \| `meeting` \| `proposal` |  |
| `summary` **(required)** | string |  |
| `nextFollowUp` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |

### `contacts_delete` — Delete a contact

destructive · idempotent

Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the contact. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

### `money_list` — Money entries

read · idempotent

Income and expense entries with payments and balance due.

| Field | Type | Notes |
|---|---|---|
| `from` | date | Local calendar date. Format YYYY-MM-DD. |
| `to` | date | Local calendar date. Format YYYY-MM-DD. |
| `direction` | `income` \| `expense` |  |
| `status` | enum[] |  |
| `contactId` | string | ID of the contact. |
| `projectId` | string | ID of the project. |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `money_add` — Add income / expense

write

Records an income (invoice, expected payment) or expense.

| Field | Type | Notes |
|---|---|---|
| `date` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `direction` **(required)** | `income` \| `expense` |  |
| `amount` **(required)** | number |  |
| `currency` | string |  |
| `category` **(required)** | string |  |
| `description` | string |  |
| `status` | `expected` \| `invoiced` \| `paid` \| `overdue` \| `cancelled` |  |
| `stream` | `active` \| `passive` |  |
| `dueDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `contactId` | string | ID of the contact. |
| `projectId` | string | ID of the project. |
| `hours` | number |  |
| `invoiceNumber` | string |  |

### `money_update` — Update a money entry

write · idempotent

Edits an entry.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the money entry. |
| `date` | date | Local calendar date. Format YYYY-MM-DD. |
| `amount` | number |  |
| `category` | string |  |
| `description` | string |  |
| `status` | `expected` \| `invoiced` \| `paid` \| `overdue` \| `cancelled` |  |
| `dueDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `contactId` | string \| null |  |
| `projectId` | string \| null |  |
| `hours` | number |  |
| `invoiceNumber` | string |  |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `money_record_payment` — Record a (partial) payment

write

Records an instalment against an entry; settles it when fully paid. Overpayment is refused.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the money entry. |
| `amount` **(required)** | number |  |
| `date` | date | Local calendar date. Format YYYY-MM-DD. |
| `method` | string |  |
| `note` | string |  |

### `money_delete_payment` — Remove a payment

destructive · idempotent

Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the money entry. |
| `paymentId` **(required)** | string | ID of the payment. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

### `money_mark_paid` — Mark fully paid

write · idempotent

Records the remaining balance as paid.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the money entry. |
| `date` | date | Local calendar date. Format YYYY-MM-DD. |

### `money_delete` — Delete a money entry

destructive · idempotent

Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the money entry. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

## research

### `studies_list` — Research studies

read · idempotent

Studies with stage, progress, themes and source counts.

| Field | Type | Notes |
|---|---|---|
| `stage` | enum[] |  |

### `studies_get` — Get a study

read · idempotent

A study with protocol, manuscript sections, themes (with evidence counts), thin-evidence gaps and its sources.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the study. |

### `studies_create` — Create a study

write

Creates a literature review / paper / experiment (and its backing goal).

| Field | Type | Notes |
|---|---|---|
| `title` **(required)** | string | Title. |
| `kind` **(required)** | `literature_review` \| `paper` \| `experiment` |  |
| `question` | string |  |
| `targetDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `themes` | string[] |  |
| `sections` | string[] | Manuscript section titles. |

### `studies_update` — Update a study

write · idempotent

Edits a study: stage, question, search strategy, target, venue, themes, notes.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the study. |
| `title` | string | Title. |
| `stage` | `planning` \| `searching` \| `screening` \| `reading` \| `synthesis` \| `writing` \| `revising` \| `submitted` \| `published` |  |
| `question` | string |  |
| `scope` | string |  |
| `searchStrategy` | string |  |
| `targetDate` | string \| null | Local calendar date, or null to clear. Format YYYY-MM-DD. |
| `venue` | string |  |
| `themes` | string[] |  |
| `notes` | string |  |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `studies_set_section` — Update a manuscript section

write

Adds (no sectionId) or updates a manuscript section: status, words, target words.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the study. |
| `sectionId` | string | ID of the section. |
| `title` | string | Title. |
| `status` | `todo` \| `outline` \| `draft` \| `revised` \| `done` |  |
| `words` | integer |  |
| `targetWords` | integer |  |

### `studies_delete` — Delete a study

destructive · idempotent

Sources stay in the library. Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the study. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

### `sources_list` — Source library

read · idempotent

Sources (papers, articles) with status, relevance, extraction fields and themes.

| Field | Type | Notes |
|---|---|---|
| `studyId` | string | ID of the study. |
| `status` | enum[] |  |
| `theme` | string |  |
| `search` | string |  |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `sources_create` — Add a source

write

Adds a source. Pass `reference` (APA/MLA text or DOI) to have fields parsed, or fields directly.

| Field | Type | Notes |
|---|---|---|
| `reference` | string | A formatted reference or DOI to parse. |
| `title` | string | Title. |
| `authors` | string |  |
| `year` | integer |  |
| `venue` | string |  |
| `doi` | string |  |
| `url` | string |  |
| `studyIds` | string[] |  |
| `status` | `to_read` \| `skimmed` \| `read` \| `extracted` \| `excluded` |  |
| `relevance` | integer |  |
| `themes` | string[] |  |
| `notes` | string |  |

### `sources_update` — Update a source

write · idempotent

Edits a source, including the literature-matrix fields (method, sample, findings, limitations).

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the source. |
| `title` | string | Title. |
| `authors` | string |  |
| `year` | integer |  |
| `venue` | string |  |
| `doi` | string |  |
| `url` | string |  |
| `studyIds` | string[] |  |
| `status` | `to_read` \| `skimmed` \| `read` \| `extracted` \| `excluded` |  |
| `relevance` | integer |  |
| `method` | string |  |
| `sample` | string |  |
| `findings` | string |  |
| `limitations` | string |  |
| `themes` | string[] |  |
| `notes` | string |  |
| `expectedUpdatedAt` | integer | Optimistic-concurrency guard: the record's `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else's edit. |

### `sources_delete` — Delete a source

destructive · idempotent

Requires confirm: true.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the source. |
| `confirm` **(required)** | boolean | Must be true. Destructive operations refuse to run without explicit confirmation. |

## exams

### `exams_list` — Exam tracks

read · idempotent

Exam tracks (SAT, AP, …) with their scores.

_No input._

### `exams_add_score` — Add a score

write

Records a practice or real score on an exam track.

| Field | Type | Notes |
|---|---|---|
| `trackId` **(required)** | string | ID of the exam track. |
| `date` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `label` **(required)** | string | e.g. "Practice test 4". |
| `kind` **(required)** | `practice` \| `mock` \| `official` |  |
| `total` | number | Total score; computed from sections when omitted. |
| `sections` | object | Section scores keyed by the track's section IDs (see exams_list). |
| `notes` | string |  |

## habits

### `habits_list` — Habits

read · idempotent

Habits with today's status and streaks.

| Field | Type | Notes |
|---|---|---|
| `date` | date | Local calendar date. Format YYYY-MM-DD. |

### `habits_check_in` — Check in a habit

write

Records a habit check-in for today.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the habit. |
| `value` | number |  |
| `minutes` | integer |  |
| `notes` | string |  |

### `habits_undo_check_in` — Undo a check-in

write · idempotent

Removes the check-in for a date.

| Field | Type | Notes |
|---|---|---|
| `id` **(required)** | string | ID of the habit. |
| `date` | date | Local calendar date. Format YYYY-MM-DD. |

## focus

### `focus_sessions` — Focus sessions

read · idempotent

Focus / timer sessions in a range with totals.

| Field | Type | Notes |
|---|---|---|
| `from` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `to` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

### `focus_status` — Running timer

read · idempotent

The timer running in the app right now, if any.

_No input._

## analytics

### `analytics_summary` — Productivity analytics

read · idempotent

Completion rates, planned vs actual time, time allocation by area, streaks, focus and XP for a range.

| Field | Type | Notes |
|---|---|---|
| `from` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `to` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |

### `analytics_time_allocation` — Time allocation

read · idempotent

Tracked minutes per area (and sub-area) in a range.

| Field | Type | Notes |
|---|---|---|
| `from` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `to` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `rollup` | boolean | Roll sub-trackers up to their top-level area. |

### `analytics_streaks` — Streaks

read · idempotent

Current and longest streak, and active days in the last N days.

| Field | Type | Notes |
|---|---|---|
| `days` | integer |  |

### `analytics_daily_review` — Daily review

read · idempotent

The metrics behind Close-the-day for a date.

| Field | Type | Notes |
|---|---|---|
| `date` | date | Local calendar date. Format YYYY-MM-DD. |

### `analytics_weekly_review` — Weekly review

read · idempotent

Weekly review metrics for a Mon–Sun range.

| Field | Type | Notes |
|---|---|---|
| `from` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |
| `to` **(required)** | date | Local calendar date. Format YYYY-MM-DD. |

### `activity_list` — Activity log

read · idempotent

The append-only log of real events (completions, sessions, payments…), newest first.

| Field | Type | Notes |
|---|---|---|
| `from` | date | Local calendar date. Format YYYY-MM-DD. |
| `to` | date | Local calendar date. Format YYYY-MM-DD. |
| `type` | string[] |  |
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |

## settings

### `settings_get` — Settings

read · idempotent

User-facing settings: theme, interface mode, background, week start, notifications, dashboard layout.

_No input._

### `settings_update` — Update settings

write · idempotent

Updates supported settings.

| Field | Type | Notes |
|---|---|---|
| `theme` | `light` \| `dark` \| `system` |  |
| `mode` | `simple` \| `advanced` | Interface mode (simple hides power-user options). |
| `background` | `galaxy` \| `still` \| `off` | Animated background. |
| `weekStartsOn` | `0` \| `1` | 0 = Sunday, 1 = Monday. |

### `notifications_get_prefs` — Notification preferences

read · idempotent

Reminder settings (lead time, which reminders), in-app banner categories, quiet hours, desktop and sound preferences.

_No input._

### `notifications_update_prefs` — Update notification preferences

write · idempotent

Updates reminder settings.

| Field | Type | Notes |
|---|---|---|
| `enabled` | boolean | Desktop reminders on/off. |
| `leadMinutes` | integer |  |
| `blockStart` | boolean |  |
| `taskDue` | boolean |  |
| `revisionDue` | boolean |  |
| `dailyReviewHour` | integer |  |

### `trackers_list` — Areas & subjects

read · idempotent

Trackers (areas, subjects) — the IDs used by blocks, tasks and goals.

| Field | Type | Notes |
|---|---|---|
| `includeArchived` | boolean |  |

### `trackers_create` — Create an area / subject

write · idempotent

Adds a tracker (area or subject), optionally under a parent tracker. A tracker with the same name under the same parent is returned instead of duplicated.

| Field | Type | Notes |
|---|---|---|
| `name` **(required)** | string | Title. |
| `pillar` **(required)** | `study` \| `fitness` \| `skills` \| `personal` \| `system` |  |
| `parentId` | string \| null | ID of the parent tracker, or null for a top-level area. |
| `color` | `indigo` \| `teal` \| `amber` \| `rose` \| `violet` \| `slate` \| `sky` \| `lime` \| `stone` |  |
| `weeklyTargetMinutes` | integer |  |

## system

### `system_info` — App info

read · idempotent

App version, schema version, record counts and the agent's permission level.

_No input._

### `audit_log` — Agent audit log

read · idempotent

Recent agent-performed operations with outcome, newest first.

| Field | Type | Notes |
|---|---|---|
| `limit` | integer | Max items to return (1–500). |
| `offset` | integer | Items to skip, for pagination. |
| `op` | string | Filter by operation name. |
