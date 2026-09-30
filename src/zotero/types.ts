import { PartialCSLEntry } from 'src/bib/types';

export type ZoteroSource = 'auto' | 'native' | 'bbt';
export type ZoteroProviderId = 'native' | 'bbt';

/** A Zotero library: the user library (id 1) or a group library. */
export interface ZoteroLibrary {
  id: number;
  name: string;
}

/** Id Zotero (and Better BibTeX) use for the personal "My Library". */
export const USER_LIBRARY_ID = 1;

export interface ZoteroConnection {
  /** Which backend is usable right now, if any. */
  provider: ZoteroProviderId | null;
  state: 'ready' | 'unreachable' | 'local-api-disabled';
}

/** One bibliography item as stored in a library cache. */
export interface CachedItem {
  /** Zotero item key (e.g. "PPVZIJTU"); absent for caches built by Better BibTeX. */
  key?: string;
  version?: number;
  csl: PartialCSLEntry;
}

export interface LibraryCache {
  schema: number;
  provider: ZoteroProviderId;
  libraryId: number;
  /** Zotero library version the cache reflects (native provider only). */
  version: number;
  /** ms since epoch of the last successful sync. */
  syncedAt: number;
  items: CachedItem[];
}

export interface LibrarySyncResult {
  library: ZoteroLibrary;
  cache: LibraryCache;
  /** false when the library had not changed since the cached version. */
  changed: boolean;
}

export interface ZoteroUpdate {
  /** Every entry, across every selected library. */
  entries: PartialCSLEntry[];
  provider: ZoteroProviderId;
}
