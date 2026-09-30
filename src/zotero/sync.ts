import { PartialCSLEntry } from 'src/bib/types';
import { readCache, writeCache, CACHE_SCHEMA } from './cache';
import {
  exportBbtLibrary,
  fetchBbtLinks,
  listBbtLibraries,
  probeBbt,
} from './bbt';
import { ZoteroUnreachableError } from './http';
import {
  LocalApiDisabledError,
  fetchAllKeys,
  fetchChangedItems,
  fetchPdfLinks,
  getLibraryVersion,
  listNativeLibraries,
  probeNative,
  selectUri,
} from './native';
import {
  CachedItem,
  LibraryCache,
  USER_LIBRARY_ID,
  ZoteroConnection,
  ZoteroLibrary,
  ZoteroProviderId,
  ZoteroSource,
  ZoteroUpdate,
} from './types';

export interface ZoteroSyncSettings {
  port: string;
  source: ZoteroSource;
  /** Libraries the user selected. */
  libraries: ZoteroLibrary[];
}

/** A long-running job the user can watch (e.g. the first import). */
export interface ZoteroTask {
  update(message: string): void;
  /** Ends the task; `message`, if given, stays visible for a few seconds. */
  finish(message?: string): void;
}

export interface ZoteroSyncHost {
  getSettings(): ZoteroSyncSettings;
  cacheDir(): string;
  /** Show a message to the user. Used sparingly: only for things they can act on. */
  notify(message: string): void;
  /** Show progress for a long job. Optional: without it the job runs silently. */
  startTask?(message: string): ZoteroTask;
}

/** Below this many items an import is quick enough not to announce. */
export const LARGE_IMPORT_THRESHOLD = 300;

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncOptions {
  /** Skip the throttle (user-initiated refresh). */
  force?: boolean;
  /** Discard cached data and re-import everything. */
  rebuild?: boolean;
  /** Minimum ms since the previous check; default 0. */
  minIntervalMs?: number;
}

export interface ItemLinks {
  select?: string;
  pdfs: Array<{ url: string; label: string }>;
}

const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000, 120000, 300000];

function uniqueById(entries: PartialCSLEntry[]) {
  const seen = new Map<string, PartialCSLEntry>();
  for (const e of entries) seen.set(e.id, e);
  return Array.from(seen.values());
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'Unknown error';
}

/**
 * Progress display is cosmetic: whatever the UI does (or fails to do) must
 * never interrupt a sync.
 */
function safeTask(task: ZoteroTask | undefined): ZoteroTask | undefined {
  if (!task) return undefined;
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      console.warn('Zotero progress display failed', e);
    }
  };
  return {
    update: (m) => guard(() => task.update(m)),
    finish: (m) => guard(() => task.finish(m)),
  };
}

export class ZoteroSync {
  status: SyncStatus = 'idle';
  /** Human-readable reason for `error` / `offline`. */
  lastError: string | null = null;
  provider: ZoteroProviderId | null = null;
  lastSyncedAt = 0;

  onUpdate: ((update: ZoteroUpdate) => void) | null = null;
  onStatus: ((status: SyncStatus) => void) | null = null;

  private caches = new Map<number, LibraryCache>();
  private inflight: Promise<boolean> | null = null;
  private lastCheckAt = 0;
  private retryTimer: number | null = null;
  private retryCount = 0;
  private notified = new Set<string>();
  private destroyed = false;

  constructor(private host: ZoteroSyncHost) {}

  destroy() {
    this.destroyed = true;
    this.cancelRetry();
    this.onUpdate = null;
    this.onStatus = null;
  }

  private setStatus(status: SyncStatus, error: string | null = null) {
    this.status = status;
    this.lastError = error;
    this.onStatus?.(status);
  }

  private notifyOnce(message: string) {
    if (this.notified.has(message)) return;
    this.notified.add(message);
    this.host.notify(message);
  }

  // --- provider selection -------------------------------------------------

  async connect(): Promise<ZoteroConnection> {
    const { port, source } = this.host.getSettings();

    if (source !== 'bbt') {
      const native = await probeNative(port);
      if (native === 'ready') return { provider: 'native', state: 'ready' };
      if (source === 'native') return { provider: null, state: native };
    }

    if (await probeBbt(port)) return { provider: 'bbt', state: 'ready' };

    // Nothing usable. Distinguish "switch on the local API" from "start Zotero".
    if (source !== 'bbt' && (await probeNative(port)) === 'local-api-disabled') {
      return { provider: null, state: 'local-api-disabled' };
    }
    return { provider: null, state: 'unreachable' };
  }

  async listLibraries(): Promise<ZoteroLibrary[] | null> {
    const { port } = this.host.getSettings();
    const conn = await this.connect();
    if (!conn.provider) return null;
    return conn.provider === 'native'
      ? listNativeLibraries(port)
      : listBbtLibraries(port);
  }

  // --- cache --------------------------------------------------------------

  private cacheFor(provider: ZoteroProviderId, libraryId: number) {
    const held = this.caches.get(libraryId);
    if (held && held.provider === provider) return held;
    const read = readCache(this.host.cacheDir(), provider, libraryId);
    if (read) this.caches.set(libraryId, read);
    return read;
  }

  /**
   * Entries from disk, without touching Zotero. Lets the plugin work
   * immediately (and offline) while a sync runs in the background.
   */
  loadCached(): ZoteroUpdate | null {
    const { libraries, source } = this.host.getSettings();
    const order: ZoteroProviderId[] =
      source === 'bbt' ? ['bbt'] : source === 'native' ? ['native'] : ['native', 'bbt'];

    for (const provider of order) {
      const found = libraries
        .map((lib) => ({ lib, cache: this.cacheFor(provider, lib.id) }))
        .filter((x) => !!x.cache);
      if (found.length) {
        return this.buildUpdate(provider, found.map((f) => f.cache), libraries);
      }
    }
    return null;
  }

  private buildUpdate(
    provider: ZoteroProviderId,
    caches: LibraryCache[],
    libraries: ZoteroLibrary[]
  ): ZoteroUpdate {
    const known = new Set(libraries.map((l) => l.id));
    const entries: PartialCSLEntry[] = [];
    for (const cache of caches) {
      if (!known.has(cache.libraryId)) continue;
      for (const item of cache.items) {
        entries.push({
          ...item.csl,
          groupID: cache.libraryId,
          zoteroKey: item.key,
        });
      }
    }
    return { entries: uniqueById(entries), provider };
  }

  // --- sync ---------------------------------------------------------------

  /** Resolves true when the bibliography changed. Never rejects. */
  sync(opts: SyncOptions = {}): Promise<boolean> {
    if (this.destroyed) return Promise.resolve(false);
    if (this.inflight !== null) return this.inflight;

    const { minIntervalMs = 0, force } = opts;
    if (!force && minIntervalMs && Date.now() - this.lastCheckAt < minIntervalMs) {
      return Promise.resolve(false);
    }

    this.inflight = this.run(opts)
      .catch((e: unknown) => {
        console.error('Zotero sync failed', e);
        this.setStatus('error', describeError(e));
        return false;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  private async run(opts: SyncOptions): Promise<boolean> {
    const settings = this.host.getSettings();
    if (!settings.libraries.length) return false;

    this.setStatus('syncing');
    const conn = await this.connect();

    if (!conn.provider) {
      this.provider = null;
      if (conn.state === 'local-api-disabled') {
        const msg =
          'Zotero is running, but it is not accepting connections from other apps, and Better BibTeX was not found. In Zotero, open Settings > Advanced and enable "Allow other applications on this computer to communicate with Zotero".';
        this.setStatus('error', msg);
        this.notifyOnce(`Better Pandoc Reference List: ${msg}`);
      } else {
        this.setStatus('offline', 'Cannot connect to Zotero');
        this.scheduleRetry();
      }
      return false;
    }

    this.provider = conn.provider;
    this.cancelRetry();
    this.lastCheckAt = Date.now();

    let anyChanged = false;
    const used: LibraryCache[] = [];
    const errors: string[] = [];

    for (const library of settings.libraries) {
      const cached = opts.rebuild ? null : this.cacheFor(conn.provider, library.id);
      try {
        const { cache, changed } =
          conn.provider === 'native'
            ? await this.syncNative(settings.port, library, cached)
            : await this.syncBbt(settings.port, library, cached);
        this.caches.set(library.id, cache);
        used.push(cache);
        anyChanged = anyChanged || changed;
      } catch (e: unknown) {
        if (e instanceof LocalApiDisabledError) throw e;
        if (e instanceof ZoteroUnreachableError) {
          // Zotero went away mid-sync; keep what we have and try again later.
          this.setStatus('offline', 'Cannot connect to Zotero');
          this.scheduleRetry();
          return false;
        }
        console.error(`Error syncing Zotero library "${library.name}"`, e);
        errors.push(`${library.name}: ${describeError(e)}`);
        if (cached) used.push(cached);
      }
    }

    if (errors.length) {
      this.setStatus('error', errors.join('; '));
      this.notifyOnce(`Better Pandoc Reference List: could not sync Zotero (${errors[0]})`);
    } else {
      this.setStatus('idle');
      this.lastSyncedAt = Date.now();
    }

    if (anyChanged && this.onUpdate) {
      this.onUpdate(this.buildUpdate(conn.provider, used, settings.libraries));
    }
    return anyChanged;
  }

  private async syncNative(
    port: string,
    library: ZoteroLibrary,
    cached: LibraryCache | null
  ): Promise<{ cache: LibraryCache; changed: boolean }> {
    const version = await getLibraryVersion(port, library);

    // A cache *ahead* of Zotero didn't come from this library's history (e.g.
    // it was copied from another machine, or the library was reset), so
    // `since=cached.version` would silently skip changes. Start over.
    if (cached && cached.version > version) cached = null;

    if (cached && cached.version === version) {
      return { cache: cached, changed: false };
    }

    const since = cached ? cached.version : 0;
    let task: ZoteroTask | undefined;
    let fetched: Awaited<ReturnType<typeof fetchChangedItems>>;
    try {
      fetched = await fetchChangedItems(port, library, since, (done, total) => {
        if (cached || total <= LARGE_IMPORT_THRESHOLD) return;
        const message = `Importing your Zotero library: ${done} of ${total} items. This only happens once.`;
        if (!task) task = safeTask(this.host.startTask?.(message));
        else task.update(message);
      });
    } catch (e) {
      task?.finish();
      throw e;
    }
    const { items, touched } = fetched;
    task?.finish(`Zotero library imported: ${items.length} items.`);

    const byKey = new Map<string, CachedItem>();
    if (cached) {
      for (const it of cached.items) if (it.key) byKey.set(it.key, it);
    }
    let changed = !cached;
    for (const key of touched) {
      if (byKey.delete(key)) changed = true;
    }
    for (const it of items) {
      byKey.set(it.key, it);
      changed = true;
    }

    if (cached) {
      const live = await fetchAllKeys(port, library);
      for (const key of Array.from(byKey.keys())) {
        if (!live.has(key)) {
          byKey.delete(key);
          changed = true;
        }
      }
    }

    const cache: LibraryCache = {
      schema: CACHE_SCHEMA,
      provider: 'native',
      libraryId: library.id,
      version,
      syncedAt: Date.now(),
      items: Array.from(byKey.values()),
    };

    // Annotation-only edits bump the library version without touching any
    // citable item; remember the version in memory but skip rewriting the file.
    if (changed) writeCache(this.host.cacheDir(), cache);
    return { cache, changed };
  }

  private async syncBbt(
    port: string,
    library: ZoteroLibrary,
    cached: LibraryCache | null
  ): Promise<{ cache: LibraryCache; changed: boolean }> {
    const list = await exportBbtLibrary(port, library);
    const items: CachedItem[] = list.map((csl) => ({ csl }));

    const changed =
      !cached || JSON.stringify(cached.items) !== JSON.stringify(items);

    const cache: LibraryCache = {
      schema: CACHE_SCHEMA,
      provider: 'bbt',
      libraryId: library.id,
      version: 0,
      syncedAt: Date.now(),
      items: changed ? items : (cached).items,
    };
    if (changed) writeCache(this.host.cacheDir(), cache);
    return { cache, changed };
  }

  // --- retry --------------------------------------------------------------

  private scheduleRetry() {
    if (this.retryTimer || this.destroyed) return;
    const delay =
      RETRY_DELAYS_MS[Math.min(this.retryCount, RETRY_DELAYS_MS.length - 1)];
    this.retryCount++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.sync({ force: true });
    }, delay);
  }

  private cancelRetry() {
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryCount = 0;
  }

  // --- links --------------------------------------------------------------

  /** "Open in Zotero" / PDF links for some entries. Best effort, never throws. */
  async getLinks(entries: PartialCSLEntry[]): Promise<Map<string, ItemLinks>> {
    const out = new Map<string, ItemLinks>();
    if (!entries.length) return out;
    const { port, libraries } = this.host.getSettings();
    const libById = new Map(libraries.map((l) => [l.id, l]));

    const native = entries.filter((e) => e.zoteroKey && e.groupID !== undefined);
    const other = entries.filter((e) => !e.zoteroKey && e.groupID !== undefined);

    await Promise.all(
      native.map(async (e) => {
        const lib = libById.get(e.groupID) ?? {
          id: e.groupID,
          name: String(e.groupID),
        };
        const links: ItemLinks = { pdfs: [] };
        try {
          links.select = selectUri(lib, e.zoteroKey);
        } catch {
          return; // malformed key (e.g. a tampered cache): offer no links
        }
        out.set(e.id, links);
        try {
          const urls = await fetchPdfLinks(port, lib, e.zoteroKey);
          links.pdfs = urls.map((url) => ({ url, label: 'PDF' }));
        } catch {
          // links are a nicety; ignore
        }
      })
    );

    const byLibrary = new Map<number, string[]>();
    for (const e of other) {
      const list = byLibrary.get(e.groupID) ?? [];
      list.push(e.id);
      byLibrary.set(e.groupID, list);
    }
    for (const [libraryId, keys] of byLibrary) {
      try {
        for (const item of await fetchBbtLinks(port, keys, libraryId)) {
          out.set(item.citekey, {
            select: item.select,
            pdfs: item.pdfPaths.map((p) => ({
              url: `file://${encodeURI(p)}`,
              label: p.split(/[\\/]/).pop(),
            })),
          });
        }
      } catch {
        // links are a nicety; ignore
      }
    }

    return out;
  }
}

export { USER_LIBRARY_ID };
