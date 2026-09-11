import type { AdapterCapabilities, StorageAdapter } from '../types';

/**
 * MemoryAdapter — the floor of the adapter stack.
 *
 * Holds collections in a Map. Nothing survives a reload, so it is only ever
 * the active adapter when everything else is unavailable (and in tests, where
 * it is the fake every other layer is exercised against).
 */
export class MemoryAdapter implements StorageAdapter {
  readonly id = 'memory' as const;
  readonly capabilities: AdapterCapabilities = {
    canAutoSave: true,
    isPersistent: false,
    producesRealFiles: false,
    label: 'In memory only',
    description:
      'Nothing is being written anywhere. Data lives only in this tab and is lost when you close it — export a bundle before you leave.',
  };

  private store = new Map<string, string>();

  target(): string {
    return 'this tab (volatile)';
  }

  async read(name: string): Promise<string | null> {
    return this.store.get(name) ?? null;
  }

  async write(name: string, text: string): Promise<void> {
    this.store.set(name, text);
  }

  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }

  async remove(name: string): Promise<void> {
    this.store.delete(name);
  }
}
