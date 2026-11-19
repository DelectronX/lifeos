/**
 * Who is performing the current mutation. The agent dispatcher runs ONE
 * operation at a time and sets this for its duration, so events written while
 * an agent operation runs are tagged `meta.source = "agent"` and can be told
 * apart from the user's own actions in history and analytics.
 */
export type Actor = { kind: 'user' } | { kind: 'agent'; client: string; op: string };

let current: Actor = { kind: 'user' };

export function currentActor(): Actor {
  return current;
}

export async function runAs<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  const previous = current;
  current = actor;
  try {
    return await fn();
  } finally {
    current = previous;
  }
}
