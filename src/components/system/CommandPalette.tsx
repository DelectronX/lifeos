import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fuzzyScore, highlightSegments } from '@/lib/fuzzy';
import { modKeyLabel } from '@/lib/platform';
import { Kbd } from '@/components/ui/Kbd';
import { SECTION_ORDER, useCommands, type Command, type CommandSection } from './commands';

/**
 * CommandPalette — the signature OS surface.
 *
 * ⌘K / Ctrl K anywhere. Fuzzy search across navigation, tasks, goals and
 * quick actions, grouped under section headers, fully keyboard driven:
 *   ↑ ↓        move (wraps)
 *   Tab / ⇧Tab move (same as arrows — the list is the only focus target)
 *   Enter      run the highlighted command
 *   Esc        clear the query, then close
 *   Home / End jump to the first / last result
 *
 * The input keeps DOM focus the whole time; selection is expressed via
 * `aria-activedescendant`, which is what a combobox is supposed to do.
 */

const RECENTS_KEY = 'lifeos.palette.recents';
const MAX_RECENTS = 6;
const MAX_ROWS = 60;

interface Ranked {
  command: Command;
  score: number;
  indices: readonly number[];
}

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeRecents(ids: string[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, MAX_RECENTS)));
  } catch {
    /* private mode */
  }
}

/** Ranks commands for a query. An empty query returns recents + suggestions. */
export function rankCommands(
  commands: readonly Command[],
  query: string,
  recents: readonly string[],
): Ranked[] {
  const q = query.trim();

  if (!q) {
    const byId = new Map(commands.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: Ranked[] = [];
    for (const id of recents) {
      const c = byId.get(id);
      if (c && !seen.has(id)) {
        seen.add(id);
        out.push({ command: c, score: 1000, indices: [] });
      }
    }
    const suggested = commands
      .filter((c) => !seen.has(c.id) && (c.weight ?? 0) > 0)
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      .slice(0, 8);
    for (const c of suggested) out.push({ command: c, score: c.weight ?? 0, indices: [] });
    return out;
  }

  const ranked: Ranked[] = [];
  for (const c of commands) {
    const m = fuzzyScore(q, [c.title, c.subtitle ?? '', c.keywords ?? '']);
    if (!m) continue;
    const boost = (c.weight ?? 0) * 0.12 + (recents.includes(c.id) ? 8 : 0);
    ranked.push({ command: c, score: m.score + boost, indices: m.indices });
  }
  ranked.sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title));
  return ranked.slice(0, MAX_ROWS);
}

/** Groups ranked rows into section blocks, preserving global rank order. */
function groupRanked(rows: readonly Ranked[], empty: boolean): Array<{
  label: string;
  rows: Ranked[];
}> {
  if (empty) {
    // Recents first (score 1000), then everything else as "Suggested".
    const recent = rows.filter((r) => r.score >= 1000);
    const rest = rows.filter((r) => r.score < 1000);
    const blocks: Array<{ label: string; rows: Ranked[] }> = [];
    if (recent.length) blocks.push({ label: 'Recent', rows: recent });
    if (rest.length) blocks.push({ label: 'Suggested', rows: rest });
    return blocks;
  }
  const buckets = new Map<CommandSection, Ranked[]>();
  for (const r of rows) {
    const list = buckets.get(r.command.section);
    if (list) list.push(r);
    else buckets.set(r.command.section, [r]);
  }
  return SECTION_ORDER.filter((s) => buckets.has(s)).map((s) => ({
    label: s,
    rows: buckets.get(s) ?? [],
  }));
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Seed query, applied each time the palette opens. */
  initialQuery?: string;
}

export function CommandPalette({ open, onClose, initialQuery = '' }: CommandPaletteProps) {
  const commands = useCommands();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const isEmptyQuery = query.trim().length === 0;
  const ranked = useMemo(
    () => rankCommands(commands, query, recents),
    [commands, query, recents],
  );
  const blocks = useMemo(() => groupRanked(ranked, isEmptyQuery), [ranked, isEmptyQuery]);
  const flat = useMemo(() => blocks.flatMap((b) => b.rows), [blocks]);

  // Reset per-open, and remember where focus came from.
  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(initialQuery);
    setActive(0);
    setRecents(readRecents());
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      restoreFocus.current?.focus?.();
    };
  }, [open, initialQuery]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  // Keep the highlighted row in view without smooth-scroll jitter.
  useLayoutEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open, flat.length]);

  const runAt = useCallback(
    (index: number) => {
      const row = flat[index];
      if (!row) return;
      const next = [row.command.id, ...recents.filter((id) => id !== row.command.id)].slice(0, MAX_RECENTS);
      writeRecents(next);
      setRecents(next);
      onClose();
      void row.command.run();
    },
    [flat, recents, onClose],
  );

  const move = useCallback(
    (delta: number) => {
      setActive((cur) => {
        if (!flat.length) return 0;
        return (cur + delta + flat.length) % flat.length;
      });
    },
    [flat.length],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault(); move(1); break;
      case 'ArrowUp':
        e.preventDefault(); move(-1); break;
      case 'Tab':
        e.preventDefault(); move(e.shiftKey ? -1 : 1); break;
      case 'Home':
        e.preventDefault(); setActive(0); break;
      case 'End':
        e.preventDefault(); setActive(Math.max(0, flat.length - 1)); break;
      case 'Enter':
        e.preventDefault(); runAt(active); break;
      case 'Escape':
        e.preventDefault();
        if (query) setQuery('');
        else onClose();
        break;
      default:
        break;
    }
  };

  if (!open) return null;

  const mod = modKeyLabel();
  let cursor = -1;

  return createPortal(
    <div className="fixed inset-0 z-palette" role="presentation">
      {/* Scrim: a dim, not a blur. */}
      <div
        className="absolute inset-0 bg-[rgb(0_0_0/0.5)] animate-fade"
        onClick={onClose}
        aria-hidden
      />

      <div className="absolute inset-0 flex items-start justify-center overflow-y-auto p-4 pt-[12vh] sm:pt-[16vh]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className={cn(
            'relative flex w-full max-w-[38rem] flex-col overflow-hidden',
            'rounded-window border border-line-strong bg-surface-overlay shadow-overlay',
            'animate-scale',
          )}
          onKeyDown={onKeyDown}
        >
          {/* Query row */}
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search commands, tasks, goals…"
              aria-label="Search commands"
              role="combobox"
              aria-expanded
              aria-controls="lo-palette-list"
              aria-activedescendant={flat[active] ? `lo-cmd-${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'h-14 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink',
                'placeholder:text-ink-faint focus:outline-none',
                // The dialog itself is the focus context; the global ring would
                // draw a redundant box around the whole query row.
                'focus-visible:!shadow-none',
              )}
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                className="rounded-[var(--r-xs)] p-1 text-ink-faint transition-colors duration-fast ease-calm hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <Kbd className="shrink-0">Esc</Kbd>
            )}
          </div>

          {/* Results */}
          <div
            ref={listRef}
            id="lo-palette-list"
            role="listbox"
            aria-label="Results"
            className="max-h-[min(26rem,52vh)] overflow-y-auto overscroll-contain p-2"
          >
            {flat.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <div className="t-section">No matches</div>
                <p className="t-meta mt-1">
                  Nothing matched “{query.trim()}”. Try a shorter query.
                </p>
              </div>
            ) : (
              blocks.map((block) => (
                <div key={block.label} className="mb-1 last:mb-0">
                  <div
                    role="presentation"
                    className="t-label px-3 pb-1 pt-2"
                  >
                    {block.label}
                  </div>
                  {block.rows.map((row) => {
                    cursor += 1;
                    const index = cursor;
                    const isActive = index === active;
                    const Icon = row.command.icon;
                    return (
                      <div
                        key={row.command.id}
                        id={`lo-cmd-${index}`}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive}
                        onMouseMove={() => { if (!isActive) setActive(index); }}
                        onClick={() => runAt(index)}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-[var(--r-md)] px-3 py-2',
                          'transition-colors duration-fast ease-calm',
                          isActive
                            ? 'bg-accent/[0.14] text-ink ring-1 ring-inset ring-accent/25'
                            : 'text-ink-muted',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0',
                            isActive ? 'text-accent-ink' : 'text-ink-faint',
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-ink">
                            {highlightSegments(row.command.title, row.indices).map((seg, i) => (
                              <span
                                key={i}
                                className={seg.hit ? 'font-semibold text-accent-ink' : undefined}
                              >
                                {seg.text}
                              </span>
                            ))}
                          </div>
                          {row.command.subtitle ? (
                            <div className="t-meta truncate">{row.command.subtitle}</div>
                          ) : null}
                        </div>
                        {row.command.shortcut ? (
                          <span className="flex shrink-0 items-center gap-0.5">
                            {row.command.shortcut.map((k) => <Kbd key={k}>{k}</Kbd>)}
                          </span>
                        ) : null}
                        {isActive ? (
                          <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer legend */}
          <div className="flex items-center gap-4 border-t border-line bg-surface px-4 py-2">
            <span className="t-meta flex items-center gap-1.5">
              <Kbd>↑</Kbd><Kbd>↓</Kbd> navigate
            </span>
            <span className="t-meta flex items-center gap-1.5">
              <Kbd>↵</Kbd> run
            </span>
            <span className="t-meta ml-auto flex items-center gap-1.5">
              <Kbd>{mod}</Kbd><Kbd>K</Kbd>
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
