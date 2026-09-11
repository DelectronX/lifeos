/**
 * DirtyTracker — remembers which collections changed since the last flush.
 *
 * Rewriting all 22 JSON files because one task moved would be wasteful on a
 * phone-hosted server and would churn every file in the user's sync client.
 * So mutations mark a single collection dirty and the flush only rewrites
 * those, plus the manifest.
 *
 * Kept deliberately free of timers and I/O so it can be tested directly.
 */
export class DirtyTracker {
  private dirty = new Set<string>();
  /** Collections handed to an in-flight flush, held back in case it fails. */
  private inFlight = new Set<string>();
  private listeners = new Set<(count: number) => void>();

  mark(...names: string[]): void {
    let changed = false;
    for (const name of names) {
      if (!this.dirty.has(name)) {
        this.dirty.add(name);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  markAll(names: Iterable<string>): void {
    this.mark(...names);
  }

  get size(): number {
    return this.dirty.size + this.inFlight.size;
  }

  isDirty(name?: string): boolean {
    if (name === undefined) return this.size > 0;
    return this.dirty.has(name) || this.inFlight.has(name);
  }

  snapshot(): string[] {
    return [...new Set([...this.dirty, ...this.inFlight])].sort();
  }

  /**
   * Removes the current dirty set and returns it. Anything marked *during*
   * the resulting write stays dirty, so a mutation racing a flush is never
   * lost — it is simply picked up by the next one.
   */
  take(): string[] {
    const taken = [...this.dirty];
    this.dirty.clear();
    this.inFlight = new Set(taken);
    if (taken.length) this.emit();
    return taken;
  }

  /** Call after a successful write of the taken set. */
  settle(): void {
    if (this.inFlight.size === 0) return;
    this.inFlight.clear();
    this.emit();
  }

  /** Call when the write failed: the taken set goes back to dirty. */
  restore(): void {
    if (this.inFlight.size === 0) return;
    for (const name of this.inFlight) this.dirty.add(name);
    this.inFlight.clear();
    this.emit();
  }

  clear(): void {
    const had = this.size > 0;
    this.dirty.clear();
    this.inFlight.clear();
    if (had) this.emit();
  }

  subscribe(listener: (count: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.size);
  }
}
