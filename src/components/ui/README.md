# LifeOS design system

> A calm operating system, not a dashboard template.

Dark is the **default** and the polished theme. Light is fully supported and
derives from the **same token names**, so every component is written once and
themed zero times. There are no `dark:` branches in new component code — if you
find yourself writing one, the token layer is missing something.

**Depth comes from luminance steps and hairlines.** Not from heavy shadows, not
from glassmorphism blur, not from gradient washes. One restrained accent
(blue-violet) is reserved for active state, focus rings and a single data
highlight per view. Typography carries the hierarchy.

Explicitly avoided: neon, gradient washes, blur walls, chart soup, floating-card
clutter, card-inside-card nesting, anything that reads as a generic SaaS admin
template.

---

## 1. The token layer

All tokens live in `src/index.css` under `@layer base`, declared on `:root`
(dark) and overridden on `:root:not(.dark)` (light). They are **space-separated
RGB triples**, not `rgb()` strings, so Tailwind's `<alpha-value>` syntax works
everywhere: `bg-accent/12`, `border-line/60`, `text-ink-muted/80`.

`tailwind.config.js` maps each token to a utility name. Always use the utility
(`bg-surface-raised`), never the raw variable, unless you need it inside a
`box-shadow` or gradient.

### `--c-surface-*` — background luminance steps

The whole sense of depth. Surfaces get *lighter* as they come forward. Never
skip a step and never nest two panels of the same tone.

| Token | Utility | Dark | Purpose |
|---|---|---|---|
| `--c-surface-base` | `bg-surface-base` | `#0B0D10` | The "desktop" backdrop. The `<body>`. Nothing else. |
| `--c-surface-sunken` | `bg-surface-sunken` | `#0F1115` | Wells and inset regions — segmented-control tracks, code areas, table stripes. |
| `--c-surface` | `bg-surface` | `#131619` | Persistent chrome: sidebar rail, window chrome, bottom tab bar. |
| `--c-surface-raised` | `bg-surface-raised` | `#191D22` | Panels and cards. The workhorse. |
| `--c-surface-overlay` | `bg-surface-overlay` | `#20252B` | Floating layers: menus, modals, tooltips, command palette. |

### `--c-line-*` — hairlines and dividers

Each is a **solid RGB triple that is the exact composite** of a low-alpha white
hairline over its parent surface. This keeps `border-line/60` working while
still rendering as a true 1px hairline rather than a heavy rule.

| Token | Utility | Purpose |
|---|---|---|
| `--c-line-faint` | `border-line-faint` | Internal row dividers inside a panel. Barely there. |
| `--c-line` | `border-line` | The default. Panel edges, input borders. Also the global `*` border colour. |
| `--c-line-strong` | `border-line-strong` | Emphasis only: focused inputs, outline badges, scrollbar thumbs. |

Prefer **fewer borders and more space**. If a divider is only separating two
things that whitespace already separates, delete it.

### `--c-ink-*` — foreground text levels

| Token | Utility | Purpose |
|---|---|---|
| `--c-ink` | `text-ink` | Primary content, headings, metric values. |
| `--c-ink-muted` | `text-ink-muted` | Secondary copy, descriptions, inactive nav labels. |
| `--c-ink-faint` | `text-ink-faint` | Meta: timestamps, counts, uppercase eyebrow labels. |
| `--c-ink-inverse` | `text-ink-inverse` | Text on a light fill in dark theme (and vice versa). |

Three levels is the whole hierarchy. Resist inventing a fourth with opacity.

### `--c-accent-*` — the single accent

Calm blue-violet. Used for **active navigation state, focus rings, and one data
highlight per view**. Never for decoration, never for two competing things on
one screen.

| Token | Utility | Purpose |
|---|---|---|
| `--c-accent` | `bg-accent` / `text-accent` / `border-accent` | The accent fill and stroke. |
| `--c-accent-soft` | `bg-accent-soft` | Tinted background for a selected row or active segment. |
| `--c-accent-ink` | `text-accent-ink` | Accent-coloured *text* — lifted for legibility on dark. |
| `--c-accent-contrast` | `text-accent-contrast` | Text/icon colour placed **on** an accent fill. |

### `--c-positive` / `--c-caution` / `--c-critical` — semantics

Desaturated deliberately for dark backgrounds. Used as `text-positive`,
`bg-critical/12`, `border-caution/25`. Semantic colour signals *state*, never
category — tracker categories have their own colour scale.

### `--r-*` — radii

`--r-xs` 6px · `--r-sm` 8px · `--r-md` 10px · `--r-lg` 12px · `--r-xl` 16px ·
`--r-2xl` 20px. Soft and OS-like. Tailwind exposes `rounded-panel` for the
standard panel radius; use `rounded-[var(--r-md)]` when matching a control size.

### `--shadow-*` — ambient elevation

Soft and wide, never a hard drop shadow. Elevation is a *hint*, the luminance
step does the real work.

| Token | Use on |
|---|---|
| `--shadow-ambient` | Controls — buttons, inputs. Includes a 1px inset top highlight. |
| `--shadow-panel` | Panels and cards (`.panel`). |
| `--shadow-pop` | Menus, popovers, tooltips. |
| `--shadow-overlay` | Modals and the command palette. |

### `--dur-*` / `--ease-*` — motion

`--dur-fast` 120ms · `--dur-base` 160ms · `--dur-slow` 200ms · `--dur-lazy` 320ms.
`--ease-out` is the house curve for entrances; `--ease-in-out` for state
toggles. **Subtle only**: 120–200ms, 1–2px hover lift. All of it is disabled
under `prefers-reduced-motion`.

Utilities: `.animate-in-fade`, `.animate-in-rise`, `.animate-in-scale`,
`.animate-in-slide-right`, `.lift`.

### `--rail-w` / `--chrome-h` / `--sp-gutter` — shell metrics

Consumed by `AppShell`. `--rail-w` 15rem, `--rail-w-collapsed` 3.75rem,
`--chrome-h` 3rem, `--sp-gutter` 1.5rem. Change the layout here, not in
component classes.

### Typography classes (`@layer components`)

The primary hierarchy device. Prefer these over ad-hoc `text-*` stacks.

| Class | Use |
|---|---|
| `.t-display` | Page title, one per screen. |
| `.t-title` | Panel title. |
| `.t-section` | Sub-section heading inside a panel. |
| `.t-body` / `.t-muted` | Body copy, primary and secondary. |
| `.t-meta` | Timestamps, counts, captions. |
| `.t-label` | Uppercase tracking-wide eyebrow label. |
| `.t-num` / `.t-mono` | Tabular figures — **mandatory** for times, durations, metrics. |
| `.t-metric` | Large metric numeral. |
| `.panel` | The core container: panel radius + hairline + `--shadow-panel`. |

`tabular-nums` is applied globally to inputs, selects, buttons and tables so
live clocks and timers never jitter. Anywhere else a number changes over time,
add `.t-num`.

### Focus

There is exactly **one** focus ring for the whole system, defined once on
`:focus-visible` in `index.css`: a 2px base-surface halo plus a 2px accent ring.
Never add a per-component focus style; never `outline-none` without replacing it.

---

## 2. Theming

`<html>` carries `class="dark"` statically in `index.html`, and an inline
pre-paint script in `<head>` reads `localStorage['lifeos.theme']` before React
mounts, so there is **no flash**. Removing the class activates the
`:root:not(.dark)` light overrides.

```ts
import { getTheme, setTheme, type ThemeMode } from '@/lib/theme';

setTheme('dark');   // 'dark' | 'light' | 'system'
getTheme();         // persisted mode
```

`'system'` subscribes to `prefers-color-scheme` and updates live.

---

## 3. Primitives

Everything below lives in `src/components/ui/` and is re-exported from
`./Card` where noted. All accept `className` for one-off spacing; do not use it
to override colour.

### Button

```tsx
import { Button, IconButton, ButtonGroup } from '@/components/ui/Button';

<Button variant="primary" size="md" iconLeft={<Plus size={15} />} onClick={save}>
  New task
</Button>
<Button variant="ghost" loading={saving}>Save</Button>
<IconButton label="Collapse sidebar" icon={<PanelLeft size={16} />} variant="ghost" />
```

| Prop | Type | Default |
|---|---|---|
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'subtle' \| 'danger' \| 'link'` | `'secondary'` |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg'` | `'md'` |
| `iconLeft` / `iconRight` | `ReactNode` | — |
| `loading` | `boolean` — swaps the left icon for a spinner and disables | `false` |
| `fullWidth` | `boolean` | `false` |

`IconButton` additionally **requires** `label` (used as `aria-label` and title).
`ButtonGroup` joins adjacent buttons into one segmented cluster.

> One `primary` button per view. Everything else is `secondary` or `ghost`.

### Panel / Card

```tsx
import { Panel, PanelHeader, PanelSection, SectionHeading } from '@/components/ui/Card';

<Panel tone="raised">
  <PanelHeader title="Today's schedule" subtitle="9 blocks" action={<Button size="xs" variant="link">Open</Button>} />
  <PanelSection>…</PanelSection>
</Panel>
```

| Prop | Type | Default |
|---|---|---|
| `tone` | `'raised' \| 'flush' \| 'sunken' \| 'outline'` | `'raised'` |
| `padded` | `boolean` | `true` |
| `interactive` | `boolean` — adds the 1px hover lift and pointer cursor | `false` |

`Card` is an alias of `Panel` and `CardHeader` of `PanelHeader`, kept for older
call sites. `SectionHeading` is the *unboxed* variant — a heading with no
surface — and is the correct way to group content **inside** a panel.

> **Never nest a Panel inside a Panel.** Use `SectionHeading` + `Separator`, or
> step the inner region down to `tone="sunken"`.

### Badge

```tsx
import { Badge, CountBadge, TrackerBadge, Dot } from '@/components/ui/Badge';

<Badge tone="critical">Overdue</Badge>
<Badge tone="accent" dot>Planned</Badge>
<CountBadge value={12} />
<TrackerBadge color="violet" name="Mathematics" />
<Dot color="lime" />
```

`tone`: `'neutral' | 'accent' | 'positive' | 'caution' | 'critical' | 'outline' | 'solid'`
(default `'neutral'`). `size`: `'sm' | 'md'`. `dot` prepends a status dot.
`CountBadge` renders `99+` past its cap. `TrackerBadge`/`Dot` take a
`TrackerColor` and are the only place category colour is allowed.

### Input, Textarea, Select, Checkbox, Radio, Field

```tsx
import { Field, Input, Textarea, Select, Checkbox } from '@/components/ui/Input';

<Field label="Title" hint="Shown in the schedule" error={errors.title} required>
  <Input value={title} onChange={e => setTitle(e.target.value)} invalid={!!errors.title} />
</Field>

<Input sizeVariant="sm" iconLeft={<Search size={14} />} placeholder="Search…" />
<Input numeric value={minutes} />          {/* tabular figures + numeric keypad */}
<Checkbox checked={done} onChange={setDone} label="Show done" description="Include completed tasks" />
```

`Field` owns the label/hint/error layout and wires `aria-describedby`. Controls
take `invalid`, and `sizeVariant` (`'sm' | 'md' | 'lg'`, default `'md'`).
`numeric` is required on any numeric input so digits stay tabular.

### SegmentedControl

The OS-style view switcher. Preferred over tabs for 2–4 mutually exclusive views.

```tsx
import { SegmentedControl } from '@/components/ui/SegmentedControl';

<SegmentedControl
  value={view}
  onChange={setView}
  items={[
    { value: 'day',   label: 'Day',   icon: <Calendar size={14} /> },
    { value: 'week',  label: 'Week' },
    { value: 'agenda',label: 'Agenda', icon: <List size={14} /> },
  ]}
/>
```

Props: `value`, `onChange`, `items` (`{ value, label, icon?, title?, disabled? }`),
`size` (`'sm' | 'md'`), `iconOnly`, `fullWidth`. Fully keyboard navigable with
arrow keys; the active segment is the accent-soft fill.

### Tabs

```tsx
import { Tabs } from '@/components/ui/Tabs';
<Tabs value={tab} onChange={setTab} variant="underline"
      items={[{ value: 'open', label: 'Open', count: 118 }, { value: 'done', label: 'Done' }]} />
```

`variant`: `'underline' | 'pill'`. Use for many sections; use `SegmentedControl`
for a few view modes.

### EmptyState

Every list must have one. A bare region is a bug.

```tsx
import { EmptyState } from '@/components/ui/EmptyState';

<EmptyState
  icon={<Inbox size={20} />}
  title="Nothing due today"
  description="Revision entries appear here as their intervals come around."
  action={<Button size="sm" variant="secondary">Plan revision</Button>}
/>
```

Props: `icon`, `title` (required), `description`, `action`, `size`
(`'sm' | 'md'`). Write the description as a *calm explanation*, not an apology.

### Skeleton

```tsx
import { Skeleton, SkeletonText, SkeletonPanel, SkeletonRows } from '@/components/ui/Skeleton';

{loading ? <SkeletonRows rows={6} /> : <TaskList tasks={tasks} />}
```

`Skeleton` is a shimmering block sized entirely by `className`. `SkeletonText`
(`lines`), `SkeletonRows` (`rows`) and `SkeletonPanel` are the composed shapes.
Match the real content's geometry so nothing jumps on load.

### Kbd

```tsx
import { Kbd, KbdChord } from '@/components/ui/Kbd';
<Kbd>⌘</Kbd>  <KbdChord keys={['Ctrl', 'K']} />
```

`KbdChord` renders platform-correct modifiers via `@/lib/platform`. Use it for
every shortcut hint rather than typing "Ctrl+K" as text.

### Separator

```tsx
import { Separator } from '@/components/ui/Separator';
<Separator />
<Separator orientation="vertical" />
<Separator label="Earlier" />
<Separator inset />
```

A hairline. `label` centres text in the rule; `inset` pulls it clear of the
panel padding. If whitespace already separates the two regions, omit it.

### Tooltip

```tsx
import { Tooltip } from '@/components/ui/Tooltip';
<Tooltip label="Collapse sidebar" hint="⌘\" side="right">
  <IconButton label="Collapse" icon={<PanelLeft size={16} />} />
</Tooltip>
```

Props: `label` (required), `hint` (right-aligned shortcut), `side`
(`'top' | 'right' | 'bottom' | 'left'`, default `'top'`), `delayMs`, `enabled`.
Takes exactly one element child and wires `aria-describedby`. Tooltips are for
icon-only controls — never to hide information the user needs.

### Modal / ConfirmDialog

```tsx
import { Modal, ConfirmDialog } from '@/components/ui/Modal';

<Modal open={open} onClose={close} title="New block" description="Place it on today's schedule"
       size="lg" footer={<Button variant="primary" onClick={save}>Create</Button>}>
  …
</Modal>

<ConfirmDialog open={confirming} onClose={cancel} onConfirm={remove}
               title="Delete task?" message="This cannot be undone." danger />
```

`size`: `'sm' | 'md' | 'lg' | 'xl' | 'full'`. `persistent` disables
backdrop/Escape dismissal. Focus is trapped and restored; entry uses
`.animate-in-scale` over a dimmed backdrop.

### Menu

```tsx
import { Menu } from '@/components/ui/Menu';

<Menu
  align="end"
  trigger={({ toggle, ref }) => <IconButton ref={ref} label="More" icon={<MoreHorizontal size={16} />} onClick={toggle} />}
  items={[
    { label: 'Edit', icon: <Pencil size={14} />, onSelect: edit, hint: 'E' },
    { label: 'Delete', icon: <Trash size={14} />, onSelect: remove, danger: true, separated: true },
  ]}
/>
```

Items: `{ label, onSelect, icon?, hint?, danger?, disabled?, separated? }`.
Arrow keys, Enter and Escape are handled; it closes on outside click.

### Progress — ProgressBar, Ring, Stat

```tsx
import { ProgressBar, Ring, Stat } from '@/components/ui/Progress';

<ProgressBar value={0.62} color="violet" size="sm" showLabel />
<Ring value={0.03} size={72}><span className="t-num">3%</span></Ring>
<Stat label="Tracked today" value="10h 3m" sub="18h 55m still planned" />
```

`value` is **0–1**, not 0–100. `Ring` takes `size`/`stroke`/`color` and centres
its children. `Stat` is the standard metric tile — `tone` shifts the value to
`positive`/`critical`.

### Toaster

Mount `<Toaster />` once in `AppShell`; push from anywhere via the toast store.
Tones: `default | success | warning | error`.

---

## 4. Shell

`src/components/layout/`:

- **`AppShell`** — the frame. Chooses `SidebarRail` + `WindowChrome` on desktop
  or `MobileShell` below the `md` breakpoint, and provides `ShellContext`
  (sidebar collapsed state, command-palette open state).
- **`SidebarRail`** — grouped navigation (`Today` / `Work` / `Signals` /
  `System`, defined in `navigation.ts`), accent-soft active state with a left
  accent bar, collapsible to `--rail-w-collapsed` with tooltips.
- **`WindowChrome`** — the title bar: current page name, save indicator, ⌘K
  search affordance, live tabular clock.
- **`IdentityBlock`** — pinned bottom-left: avatar, level, streak, XP progress,
  theme toggle, settings.
- **`MobileShell`** — a *genuine* mobile layout: compact top bar plus a
  five-item bottom tab bar with safe-area padding. Not a squeezed desktop.

`src/components/system/`:

- **`CommandPalette`** — ⌘K / Ctrl+K. Fuzzy search (`@/lib/fuzzy`) across
  navigation, tasks, goals and quick actions, grouped by source, full keyboard
  control, shortcut hints and empty-state suggestions.
- **`commands.ts`** — command registry. Add new commands here, not in the
  palette component.
- **`SaveIndicator`** — persistence state in the window chrome.

---

## 5. Checklist for new UI

- [ ] No raw `gray-*` / `slate-*` / `white` colour classes — tokens only.
- [ ] No `dark:` variants in new code.
- [ ] Times, durations and metrics carry `.t-num`.
- [ ] Headings use the `.t-*` scale, not ad-hoc `text-lg font-bold`.
- [ ] No Panel inside a Panel.
- [ ] Every list has an `EmptyState`; every async list has a `Skeleton`.
- [ ] Icon-only controls have a `label` and a `Tooltip`.
- [ ] Nothing overrides `:focus-visible`.
- [ ] Checked at 1440px **and** 390px.
