import type { ErrorCode } from './catalog';

/** A failure with a machine-readable code, surfaced unchanged to agents. */
export class AgentError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = 'AgentError';
  }
}

export const notFound = (what: string, id: string) => new AgentError('NOT_FOUND', `${what} "${id}" does not exist.`, { id });
export const invalidState = (message: string, details?: unknown) => new AgentError('INVALID_STATE', message, details);
export const conflict = (message: string, details?: unknown) => new AgentError('CONFLICT', message, details);

/** Optimistic concurrency: refuse to overwrite a record changed since the caller read it. */
export function guardVersion(record: { updatedAt: number }, expected: number | undefined, what: string): void {
  if (expected === undefined) return;
  if (record.updatedAt !== expected) {
    throw conflict(`${what} was changed since you read it (updatedAt ${record.updatedAt}, expected ${expected}). Re-read it and retry.`, { currentUpdatedAt: record.updatedAt });
  }
}
