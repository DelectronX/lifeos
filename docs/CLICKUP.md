# ClickUp in LifeOS

LifeOS shows your ClickUp workspace inside the app (**Work → ClickUp**, route `/clickup`) using the hybrid design: native LifeOS screens built from ClickUp's API, embeds where ClickUp allows them, and "Open in ClickUp" for everything else.

## Why not just an iframe?

ClickUp's app refuses to be framed by any other site. `app.clickup.com` sends:

```
Content-Security-Policy: frame-ancestors 'self' https://clickup.com https://stage1-landing.clickup.com
```

Checked on 19 Nov 2026, and covered by a test. Browsers therefore block a plain iframe of your workspace. Only public ClickUp content is frameable (`sharing.clickup.com` share links, `forms.clickup.com`, public docs), and the **Embeds** tab supports exactly that.

A future desktop build (Tauri, see `docs/PRODUCT.md` §19) can open the real ClickUp app in a native webview window, which is not subject to frame restrictions.

## Setup

1. Make sure the local LifeOS server is running and connected (`docs/AGENTS.md`, Settings → Agents).
2. In ClickUp, open your avatar → **Settings → Apps → API Token**, and copy the token (`pk_…`).
3. In LifeOS, open **ClickUp** and paste the token.

The LifeOS server checks the token against ClickUp and then stores it in `%LOCALAPPDATA%\LifeOS\clickup.json` (file mode 600). The token is never sent back to the browser, never written to backups and never logged. **Disconnect** deletes that file.

## What you can do

| Area | Features |
|---|---|
| **Browse** | Workspace switcher; Spaces → Folders → Lists sidebar; **My tasks**: open tasks assigned to you across the workspace |
| **List view** | Status (your list's own statuses and colours), priority flag, due date (overdue in red), assignees, subtask progress, "in LifeOS" badge; filter; show closed; load more (100 per page) |
| **Board view** | Columns from the list's own statuses |
| **Create** | Quick-add a task to the selected list |
| **Task drawer** | Change status, priority, due date; read description and subtasks; read and post comments; start/stop the ClickUp timer (one running timer, starting is idempotent); Open in ClickUp |
| **Add to LifeOS** | Creates a linked LifeOS task with title, due date, priority, estimate, link and tags. You can then put it on your calendar, or let Auto Plan place it, earn XP when it is done and count it toward goals |
| **Embeds** | Save public ClickUp share links, forms and docs. Each link is checked before being framed; blocked pages show the reason and an Open in ClickUp button |

## Linked-task sync

The sync runs every 3 minutes while LifeOS is open, whenever the window comes back into view, and on **Sync now**. It goes through `src/integrations/clickup/linkService.ts`.

| Field | Owner | Behaviour |
|---|---|---|
| Title, due date, priority | ClickUp | Copied into the LifeOS task |
| Completion | Both | Whichever side changed since the last sync wins. Closing in ClickUp completes the LifeOS task (XP once, through the normal task service and its anti-farming rules). Completing in LifeOS moves the ClickUp task to its list's closed status. Reopening works both ways |
| Opposite completion changes on both sides | — | Flagged as a **conflict**; nothing is overwritten |
| Task deleted in ClickUp | — | The LifeOS task is kept and marked **missing** |
| Calendar blocks, XP, goals, streaks | LifeOS | Never touched by ClickUp |

Rules that keep progress honest:

- Already-closed ClickUp tasks cannot be imported, so finished work is never re-credited.

## Architecture

```
LifeOS page (/clickup) ──fetch + bearer──▶ local LifeOS server (127.0.0.1:7457)
                                            /api/v1/clickup/*  ── token from clickup.json ──▶ api.clickup.com/api/v2
LifeOS tasks (IndexedDB) ◀── linkService (sync loop) ──▶ same server routes
```

| Piece | File |
|---|---|
| Pure logic: normalisers, status/priority mapping, sync decision, embed verdict | `src/integrations/clickup/shared.ts` |
| Server adapter + routes (rate-limit retry, TTL cache, id validation, permission ceiling) | `agent/src/clickup.ts` (wired in `agent/src/http.ts`) |
| Browser client | `src/integrations/clickup/client.ts` |
| Link + sync | `src/integrations/clickup/linkService.ts`; `Task.external` field (optional, no migration) |
| UI | `src/features/clickup/ClickUpPage.tsx` |
| Tests | `src/integrations/clickup/__tests__/` (17 tests: fake ClickUp API, real Dexie) |

Routes are listed at the top of `agent/src/clickup.ts`. When the server permission is `read`, ClickUp changes are refused.

## Limits

- **Sync is polling, not webhooks.** ClickUp can't reach a server on your PC, so webhooks would need a public URL (planned with the hosted backend).
- **No custom fields, dependencies, attachments or Docs editing yet.** These open in ClickUp.
- **Personal token, not OAuth.** OAuth is needed before LifeOS is offered to other people (`docs/PRODUCT.md` §16).
- **Rate limits.** ClickUp allows about 100 requests per minute per token on Free/Unlimited/Business plans. The server waits once on HTTP 429, and the sync runs serially.
