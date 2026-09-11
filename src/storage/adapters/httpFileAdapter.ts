import type { AdapterCapabilities, StorageAdapter } from '../types';

export interface HttpAdapterOptions {
  /** Folder the JSON files live in, relative to the page. Default `data/`. */
  baseDir?: string;
  /** Injected for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Base URL the paths resolve against. Defaults to the document location. */
  baseUrl?: string;
}

/**
 * HttpFileAdapter — writes each collection back to the server with PUT.
 *
 * This is the best case: the app is served over http(s) by something that
 * accepts uploads (a WebDAV share, an iOS file-manager's built-in server, a
 * companion local server), so saving a task literally rewrites
 * `data/tasks.json` on disk with no user interaction at all.
 *
 * Capability is *probed*, never assumed: many static servers happily serve GET
 * and reject PUT with 403/405. The probe writes a tiny file and reads it back,
 * because some servers answer OPTIONS optimistically and then refuse the write.
 * The result is cached for the session.
 */
export class HttpFileAdapter implements StorageAdapter {
  readonly id = 'http' as const;
  readonly capabilities: AdapterCapabilities = {
    canAutoSave: true,
    isPersistent: true,
    producesRealFiles: true,
    label: 'Server folder (HTTP/WebDAV)',
    description:
      'Every change is written straight back to the JSON files on the server that is hosting this app. Nothing for you to do — the files on disk are always current.',
  };

  private readonly baseDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string | undefined;
  private probe: Promise<boolean> | null = null;

  constructor(options: HttpAdapterOptions = {}) {
    this.baseDir = (options.baseDir ?? 'data').replace(/^\/+|\/+$/g, '');
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.baseUrl = options.baseUrl;
  }

  target(): string {
    return `${this.baseUrl ?? ''}${this.baseDir}/`;
  }

  /** True when the page is served over http(s) — file:// can never PUT. */
  static isPlausible(location?: { protocol?: string }): boolean {
    const proto =
      location?.protocol ??
      (typeof globalThis !== 'undefined' && (globalThis as { location?: Location }).location?.protocol);
    return proto === 'http:' || proto === 'https:';
  }

  private url(name: string): string {
    const path = `${this.baseDir}/${name}.json`;
    if (this.baseUrl) return `${this.baseUrl.replace(/\/+$/, '')}/${path}`;
    return path;
  }

  /**
   * Trial write + read-back + cleanup. Cached, so the cost is one round trip
   * per session regardless of how many callers ask.
   */
  async ensureReady(): Promise<boolean> {
    if (this.probe) return this.probe;
    this.probe = (async () => {
      const token = `probe-${Date.now()}`;
      try {
        const put = await this.fetchImpl(this.url('.lifeos-probe'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!put.ok) return false;
        const get = await this.fetchImpl(this.url('.lifeos-probe'), { method: 'GET', cache: 'no-store' });
        if (!get.ok) return false;
        const text = await get.text();
        if (!text.includes(token)) return false;
        // Best effort: leave no litter behind. A server that refuses DELETE is
        // still a perfectly usable target, so failure here is ignored.
        try {
          await this.fetchImpl(this.url('.lifeos-probe'), { method: 'DELETE' });
        } catch { /* ignore */ }
        return true;
      } catch {
        return false;
      }
    })();
    return this.probe;
  }

  async read(name: string): Promise<string | null> {
    try {
      const response = await this.fetchImpl(this.url(name), { method: 'GET', cache: 'no-store' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (e) {
      if (e instanceof Error && /^\d{3} /.test(e.message)) throw e;
      return null;
    }
  }

  async write(name: string, text: string): Promise<void> {
    const response = await this.fetchImpl(this.url(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    });
    if (!response.ok) {
      throw new Error(`Could not save ${name}.json to the server (${response.status} ${response.statusText}).`);
    }
  }

  /**
   * WebDAV PROPFIND when available; otherwise the manifest is the index, which
   * is exactly why the repository always writes a manifest.
   */
  async list(): Promise<string[]> {
    try {
      const response = await this.fetchImpl(this.url('').replace(/\/[^/]*$/, '/'), {
        method: 'PROPFIND',
        headers: { Depth: '1' },
      });
      if (!response.ok) return [];
      const text = await response.text();
      const names = [...text.matchAll(/([A-Za-z0-9_.-]+)\.json/g)].map((m) => m[1]);
      return [...new Set(names)];
    } catch {
      return [];
    }
  }

  async remove(name: string): Promise<void> {
    try {
      await this.fetchImpl(this.url(name), { method: 'DELETE' });
    } catch { /* a server that will not delete is not a failure worth surfacing */ }
  }
}
