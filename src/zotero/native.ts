import { PartialCSLEntry } from 'src/bib/types';
import {
  ZoteroHttpError,
  ZoteroResponse,
  headerNumber,
  zoteroRequest,
} from './http';
import { CachedItem, USER_LIBRARY_ID, ZoteroLibrary } from './types';

/**
 * Talks to Zotero's built-in local API (Zotero 7+), which needs no plugins.
 * "Allow other applications on this computer to communicate with Zotero" must
 * be enabled in Zotero's settings (Advanced).
 *
 * Since Zotero 7, citation keys are a native item field, and Better BibTeX
 * writes its keys into it, so `csljson` items carry the right `id`.
 */

export class LocalApiDisabledError extends Error {
  constructor() {
    super(
      'Zotero is not accepting connections from other apps. In Zotero, open Settings > Advanced and enable "Allow other applications on this computer to communicate with Zotero".'
    );
    this.name = 'LocalApiDisabledError';
  }
}

export class LibraryNotFoundError extends Error {
  constructor(library: ZoteroLibrary) {
    super(`Zotero library "${library.name}" (${library.id}) was not found.`);
    this.name = 'LibraryNotFoundError';
  }
}

const API_HEADERS = { 'Zotero-API-Version': '3' };
const PAGE_SIZE = 100;
const PROBE_TIMEOUT = 2500;

/** Zotero item keys are short alphanumeric strings; anything else is refused. */
export function isItemKey(key: string): boolean {
  return /^[A-Za-z0-9]{1,32}$/.test(key);
}

export function apiBase(library: Pick<ZoteroLibrary, 'id'>) {
  if (!Number.isInteger(library.id) || library.id < 1) {
    throw new Error(`Invalid Zotero library id: ${String(library.id)}`);
  }
  return library.id === USER_LIBRARY_ID
    ? '/api/users/0'
    : `/api/groups/${library.id}`;
}

function get(
  port: string,
  path: string,
  timeout?: number
): Promise<ZoteroResponse> {
  return zoteroRequest(port, path, { headers: API_HEADERS, timeout });
}

function assertOk(res: ZoteroResponse, path: string, library?: ZoteroLibrary) {
  if (res.status === 200) return;
  if (res.status === 403) throw new LocalApiDisabledError();
  if (res.status === 404 && library) throw new LibraryNotFoundError(library);
  throw new ZoteroHttpError(res.status, path, res.body);
}

/** Is the local API reachable, and enabled? Never throws. */
export async function probeNative(
  port: string
): Promise<'ready' | 'local-api-disabled' | 'unreachable'> {
  try {
    const res = await get(
      port,
      '/api/users/0/items/top?limit=1&format=keys',
      PROBE_TIMEOUT
    );
    if (res.status === 200) return 'ready';
    if (res.status === 403) return 'local-api-disabled';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export async function listNativeLibraries(
  port: string
): Promise<ZoteroLibrary[]> {
  const libs: ZoteroLibrary[] = [{ id: USER_LIBRARY_ID, name: 'My Library' }];
  const path = '/api/users/0/groups';
  const res = await get(port, path);
  assertOk(res, path);
  const groups = JSON.parse(res.body) as Array<{
    id: number;
    data?: { name?: string };
  }>;
  for (const g of groups) {
    libs.push({ id: g.id, name: g.data?.name ?? `Group ${g.id}` });
  }
  return libs;
}

/** Cheap: one request, answers "has anything in this library changed?" */
export async function getLibraryVersion(
  port: string,
  library: ZoteroLibrary
): Promise<number> {
  const path = `${apiBase(library)}/items/top?limit=1&format=keys`;
  const res = await get(port, path);
  assertOk(res, path, library);
  const version = headerNumber(res, 'Last-Modified-Version');
  if (version === null) {
    throw new Error('Zotero did not report a library version.');
  }
  return version;
}

interface RawItem {
  key: string;
  version: number;
  csljson?: string;
}

export interface ChangedItems {
  /** Citable items (they have a citation key). */
  items: CachedItem[];
  /**
   * Keys of *every* item that changed, including ones that can no longer be
   * cited (their citation key was cleared): callers must drop stale copies.
   */
  touched: Set<string>;
}

/**
 * Items (with CSL-JSON) modified after library version `since`. With
 * `since = 0` this is the whole library.
 */
export async function fetchChangedItems(
  port: string,
  library: ZoteroLibrary,
  since: number,
  onProgress?: (done: number, total: number) => void
): Promise<ChangedItems> {
  const out: CachedItem[] = [];
  const touched = new Set<string>();
  let start = 0;
  let total = Infinity;

  while (start < total) {
    const path =
      `${apiBase(library)}/items/top?format=json&include=csljson` +
      `&since=${since}&limit=${PAGE_SIZE}&start=${start}`;
    const res = await get(port, path, 60000);
    assertOk(res, path, library);

    total = headerNumber(res, 'Total-Results') ?? 0;
    const page = JSON.parse(res.body) as RawItem[];
    if (!page.length) break;

    for (const raw of page) {
      touched.add(raw.key);
      const csl = parseCsl(raw);
      if (csl) {
        out.push({ key: raw.key, version: raw.version, csl });
      }
    }

    start += page.length;
    onProgress?.(Math.min(start, total), total);
  }

  return { items: out, touched };
}

function parseCsl(raw: RawItem): PartialCSLEntry | null {
  if (!raw.csljson) return null;
  let csl: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(raw.csljson) as unknown;
    csl = (Array.isArray(parsed) ? parsed[0] : parsed) as
      | Record<string, unknown>
      | undefined;
  } catch {
    return null;
  }
  // Items with no citation key (standalone attachments, notes, or libraries
  // that never generated keys) cannot be cited, so they are not listed.
  const key = csl?.['citation-key'];
  if (!csl || !key || typeof key !== 'string') return null;
  csl.id = key;
  return csl as unknown as PartialCSLEntry;
}

/** Keys of every top-level item in the library (used to detect deletions). */
export async function fetchAllKeys(
  port: string,
  library: ZoteroLibrary
): Promise<Set<string>> {
  const keys = new Set<string>();
  let start = 0;
  let total = Infinity;

  while (start < total) {
    const path = `${apiBase(library)}/items/top?format=keys&limit=1000&start=${start}`;
    const res = await get(port, path, 30000);
    assertOk(res, path, library);

    total = headerNumber(res, 'Total-Results') ?? 0;
    const page = res.body.split(/\s+/).filter(Boolean);
    if (!page.length) break;
    for (const k of page) keys.add(k);
    start += page.length;
  }

  return keys;
}

export function selectUri(library: ZoteroLibrary, itemKey: string) {
  if (!isItemKey(itemKey)) throw new Error('Invalid Zotero item key');
  return library.id === USER_LIBRARY_ID
    ? `zotero://select/library/items/${itemKey}`
    : `zotero://select/groups/${library.id}/items/${itemKey}`;
}

function openPdfUri(library: ZoteroLibrary, attachmentKey: string) {
  if (!isItemKey(attachmentKey)) throw new Error('Invalid Zotero item key');
  return library.id === USER_LIBRARY_ID
    ? `zotero://open-pdf/library/items/${attachmentKey}`
    : `zotero://open-pdf/groups/${library.id}/items/${attachmentKey}`;
}

/** PDF attachments of an item, as `zotero://open-pdf` links. */
export async function fetchPdfLinks(
  port: string,
  library: ZoteroLibrary,
  itemKey: string
): Promise<string[]> {
  if (!isItemKey(itemKey)) throw new Error('Invalid Zotero item key');
  const path = `${apiBase(library)}/items/${itemKey}/children?format=json`;
  const res = await get(port, path);
  assertOk(res, path, library);
  const children = JSON.parse(res.body) as Array<{
    key: string;
    data: { itemType: string; contentType?: string };
  }>;
  return children
    .filter(
      (c) =>
        c.data.itemType === 'attachment' &&
        c.data.contentType === 'application/pdf'
    )
    .map((c) => openPdfUri(library, c.key));
}
