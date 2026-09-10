import { EXPORTABLE_TABLES, SCHEMA_VERSION, type ExportableTable } from '@/db/db';

/**
 * MigrationService — makes old exports importable after the schema moves on.
 *
 * An export written by version N must still restore in version N+k. Rather
 * than guessing, every schema bump registers a small, pure, forward-only
 * migration here. Migrations run in order against the parsed bundle BEFORE any
 * row touches Dexie, so a failed migration costs nothing.
 */

export interface ExportBundle {
  /** Always "lifeos-export". Guards against importing an unrelated JSON file. */
  format: 'lifeos-export';
  /** Dexie schema version this bundle was written against. */
  schemaVersion: number;
  /** App version string, informational only. */
  appVersion: string;
  exportedAt: number;
  /** Table name -> rows. Attachments carry base64 blobs. */
  tables: Record<string, unknown[]>;
  /** Row counts, used to validate the payload is complete. */
  counts: Record<string, number>;
}

export interface Migration {
  /** Applies to bundles at exactly this version, producing `to`. */
  from: number;
  to: number;
  description: string;
  migrate: (bundle: ExportBundle) => ExportBundle;
}

/**
 * v1 -> v2: schedule blocks gained recurringRuleId / templateId /
 * occurrenceDate / detachedFromSeries. Old rows simply get the null defaults
 * the app treats as "not part of a series".
 */
const V1_TO_V2: Migration = {
  from: 1,
  to: 2,
  description: 'Adds recurring-series and template links to schedule blocks.',
  migrate: (bundle) => ({
    ...bundle,
    schemaVersion: 2,
    tables: {
      ...bundle.tables,
      blocks: (bundle.tables.blocks ?? []).map((row) => ({
        recurringRuleId: null,
        occurrenceDate: null,
        detachedFromSeries: false,
        templateId: null,
        ...(row as Record<string, unknown>),
      })),
    },
  }),
};

/**
 * v2 -> v3: resources gained reverse-link arrays and attachments gained
 * block/goal links; settings gained the timer/appearance/backup preference
 * groups. All are optional in the type, so the migration only needs to make
 * the multi-entry indexed fields present as arrays — Dexie will not index a
 * missing key, and a later write would then silently fail to be findable.
 */
const V2_TO_V3: Migration = {
  from: 2,
  to: 3,
  description: 'Adds resource reverse-links, attachment block/goal links and backup snapshots.',
  migrate: (bundle) => ({
    ...bundle,
    schemaVersion: 3,
    tables: {
      ...bundle.tables,
      resources: (bundle.tables.resources ?? []).map((row) => ({
        taskIds: [],
        blockIds: [],
        goalIds: [],
        ...(row as Record<string, unknown>),
      })),
      attachments: (bundle.tables.attachments ?? []).map((row) => ({
        blockId: null,
        goalId: null,
        ...(row as Record<string, unknown>),
      })),
    },
  }),
};

export const MIGRATIONS: Migration[] = [V1_TO_V2, V2_TO_V3];

export interface MigrationOutcome {
  bundle: ExportBundle;
  /** Human-readable lines describing each migration that ran. */
  applied: string[];
}

/**
 * Brings a bundle up to the current schema version, or throws with a clear
 * message when no path exists (e.g. an export from a FUTURE version).
 */
export function migrateBundle(bundle: ExportBundle): MigrationOutcome {
  if (bundle.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `This backup was written by a newer version of LifeOS (schema v${bundle.schemaVersion}; this app understands up to v${SCHEMA_VERSION}). Update the app before restoring it.`,
    );
  }

  let current = bundle;
  const applied: string[] = [];
  let guard = 0;

  while (current.schemaVersion < SCHEMA_VERSION && guard++ < 64) {
    const step = MIGRATIONS.find((m) => m.from === current.schemaVersion);
    if (!step) {
      throw new Error(
        `No migration path from schema v${current.schemaVersion} to v${SCHEMA_VERSION}. This backup cannot be restored.`,
      );
    }
    current = step.migrate(current);
    current.schemaVersion = step.to;
    applied.push(`v${step.from} → v${step.to}: ${step.description}`);
  }

  return { bundle: current, applied };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationIssue {
  severity: 'error' | 'warning';
  table: string | null;
  /** Row index within the table, when the issue is row-scoped. */
  row: number | null;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  /** Rows that would be imported, per table, after dropping invalid ones. */
  acceptedCounts: Record<string, number>;
  droppedCount: number;
}

/** Fields every entity row must carry to be storable. */
const REQUIRED_BASE_FIELDS = ['id'] as const;

const KNOWN_TABLES = new Set<string>([...EXPORTABLE_TABLES, 'attachments']);

/**
 * Strict structural validation. Refuses the whole file for structural problems
 * (wrong format marker, tables that are not arrays) and reports individual bad
 * rows so the user gets a precise error list rather than "import failed".
 */
export function validateBundle(input: unknown): ValidationReport {
  const issues: ValidationIssue[] = [];
  const acceptedCounts: Record<string, number> = {};
  let dropped = 0;

  if (!input || typeof input !== 'object') {
    return fail('The file is not a JSON object.');
  }
  const bundle = input as Partial<ExportBundle>;

  if (bundle.format !== 'lifeos-export') {
    return fail('This is not a LifeOS export file (missing the "lifeos-export" format marker).');
  }
  if (typeof bundle.schemaVersion !== 'number' || !Number.isFinite(bundle.schemaVersion)) {
    return fail('The export has no valid schemaVersion header, so it cannot be migrated safely.');
  }
  if (!bundle.tables || typeof bundle.tables !== 'object') {
    return fail('The export contains no "tables" object.');
  }

  for (const [name, rows] of Object.entries(bundle.tables)) {
    if (!KNOWN_TABLES.has(name)) {
      issues.push({
        severity: 'warning',
        table: name,
        row: null,
        message: `Unknown table "${name}" — it will be ignored.`,
      });
      continue;
    }
    if (!Array.isArray(rows)) {
      issues.push({
        severity: 'error',
        table: name,
        row: null,
        message: `Table "${name}" is not an array.`,
      });
      continue;
    }

    let accepted = 0;
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        issues.push({ severity: 'error', table: name, row: index, message: 'Row is not an object.' });
        dropped++;
        return;
      }
      const record = row as Record<string, unknown>;
      for (const field of REQUIRED_BASE_FIELDS) {
        if (typeof record[field] !== 'string' || !record[field]) {
          issues.push({
            severity: 'error', table: name, row: index,
            message: `Row is missing a valid "${field}".`,
          });
          dropped++;
          return;
        }
      }
      const id = record.id as string;
      if (seen.has(id)) {
        issues.push({
          severity: 'error', table: name, row: index,
          message: `Duplicate id "${id}" within the same table.`,
        });
        dropped++;
        return;
      }
      seen.add(id);
      accepted++;
    });

    acceptedCounts[name] = accepted;

    const declared = bundle.counts?.[name];
    if (typeof declared === 'number' && declared !== rows.length) {
      issues.push({
        severity: 'warning', table: name, row: null,
        message: `Header claims ${declared} rows but the file contains ${rows.length}.`,
      });
    }
  }

  const missing = (EXPORTABLE_TABLES as readonly string[]).filter(
    (t) => !(t in (bundle.tables ?? {})),
  );
  for (const t of missing) {
    issues.push({
      severity: 'warning', table: t, row: null,
      message: `Table "${t}" is absent from the export — it will be left empty.`,
    });
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    acceptedCounts,
    droppedCount: dropped,
  };

  function fail(message: string): ValidationReport {
    return {
      ok: false,
      issues: [{ severity: 'error', table: null, row: null, message }],
      acceptedCounts: {},
      droppedCount: 0,
    };
  }
}

/** Drops every row the validator rejected, leaving an importable bundle. */
export function pruneInvalidRows(bundle: ExportBundle, report: ValidationReport): ExportBundle {
  const badRows = new Map<string, Set<number>>();
  for (const issue of report.issues) {
    if (issue.severity !== 'error' || issue.table === null || issue.row === null) continue;
    const set = badRows.get(issue.table) ?? new Set<number>();
    set.add(issue.row);
    badRows.set(issue.table, set);
  }

  const tables: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(bundle.tables)) {
    if (!KNOWN_TABLES.has(name) || !Array.isArray(rows)) continue;
    const bad = badRows.get(name);
    tables[name] = bad ? rows.filter((_, i) => !bad.has(i)) : rows;
  }
  return { ...bundle, tables };
}

export function isExportableTable(name: string): name is ExportableTable {
  return (EXPORTABLE_TABLES as readonly string[]).includes(name);
}
