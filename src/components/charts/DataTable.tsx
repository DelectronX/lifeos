import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A small, responsive data table.
 *
 * On >=sm it renders a real <table>. Below that the same rows are re-rendered
 * as stacked label/value pairs, so a six-column performance table stays
 * readable on a phone instead of scrolling sideways into nothing.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell content. Kept as a render function so numbers stay pre-formatted. */
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Hide this column in the stacked mobile layout (usually the primary label). */
  primary?: boolean;
  className?: string;
}

export function DataTable<T>({
  columns, rows, rowKey, empty, caption, className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  caption?: ReactNode;
  className?: string;
}) {
  if (rows.length === 0) {
    return <>{empty ?? <p className="t-muted">Nothing to show for this period.</p>}</>;
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);

  return (
    <div className={cn('min-w-0', className)}>
      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          {caption ? <caption className="t-meta mb-2 text-left">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    't-label whitespace-nowrap pb-2 pr-4 font-medium last:pr-0',
                    c.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey(row, i)} className="border-b border-line/60 last:border-b-0">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'py-2 pr-4 align-middle text-ink last:pr-0',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: one stacked card per row */}
      <ul className="space-y-3 sm:hidden">
        {rows.map((row, i) => (
          <li key={rowKey(row, i)} className="rounded-lg border border-line p-3">
            <div className="text-sm font-medium text-ink">{primary.cell(row)}</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {rest.map((c) => (
                <div key={c.key} className="flex items-baseline justify-between gap-2">
                  <dt className="t-label truncate">{c.header}</dt>
                  <dd className="shrink-0 text-xs text-ink">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
