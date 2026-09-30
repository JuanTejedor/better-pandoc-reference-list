import { PartialCSLEntry } from 'src/bib/types';
import { ZoteroHttpError, zoteroRequest } from './http';
import { ZoteroLibrary } from './types';

/**
 * Fallback provider: Better BibTeX's own endpoints. Used when Zotero's local
 * API is unavailable (older Zotero, or the user disabled it).
 */

const PROBE_TIMEOUT = 2500;
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};
// BBT's "Better CSL JSON" translator
const CSL_JSON_TRANSLATOR = '36a3b0b5-bad0-4a04-b79b-441c7cef77db';

export async function probeBbt(port: string): Promise<boolean> {
  try {
    const res = await zoteroRequest(port, '/better-bibtex/cayw?probe=true', {
      timeout: PROBE_TIMEOUT,
    });
    return res.status === 200 && res.body.trim() === 'ready';
  } catch {
    return false;
  }
}

async function rpc<T>(port: string, method: string, params?: unknown[]) {
  const res = await zoteroRequest(port, '/better-bibtex/json-rpc', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    timeout: 60000,
  });
  if (res.status !== 200) {
    throw new ZoteroHttpError(res.status, method, res.body);
  }
  const parsed = JSON.parse(res.body) as {
    error?: { message?: string };
    result?: T;
  };
  if (parsed.error?.message) throw new Error(parsed.error.message);
  return parsed.result;
}

export async function listBbtLibraries(port: string): Promise<ZoteroLibrary[]> {
  const groups = await rpc<Array<{ id: number; name: string }>>(
    port,
    'user.groups'
  );
  return groups.map((g) => ({ id: g.id, name: g.name }));
}

/**
 * Better BibTeX changed how export URLs name a library: current versions
 * 404 on `library?/<id>/library.json` ("library '/1/library.json' does not
 * exist") but accept `library;id:<id>`. Older ones only know the former, so
 * both are tried.
 */
export function bbtExportPaths(libraryId: number) {
  return [
    `/better-bibtex/export?/library;id:${libraryId}/library.json`,
    `/better-bibtex/export/library?/${libraryId}/library.json`,
  ];
}

export async function exportBbtLibrary(
  port: string,
  library: ZoteroLibrary
): Promise<PartialCSLEntry[]> {
  let lastError: Error | null = null;

  for (const path of bbtExportPaths(library.id)) {
    const res = await zoteroRequest(port, path, { timeout: 120000 });
    if (res.status !== 200) {
      lastError = new ZoteroHttpError(res.status, path, res.body);
      continue;
    }

    // Validate *before* anyone caches it: an error page or a truncated body
    // must never replace a good cache.
    const parsed = JSON.parse(res.body) as unknown;
    if (!Array.isArray(parsed)) {
      lastError = new Error(`Unexpected Better BibTeX export from ${path}`);
      continue;
    }
    return parsed as PartialCSLEntry[];
  }

  throw lastError ?? new Error('Better BibTeX export failed');
}

interface BbtExportItem {
  citekey?: string;
  citationKey?: string;
  select?: string;
  attachments?: Array<{ path?: string }>;
}

export interface BbtItemLinks {
  citekey: string;
  select?: string;
  pdfPaths: string[];
}

/** Zotero select-links and PDF paths for a set of citekeys. */
export async function fetchBbtLinks(
  port: string,
  citekeys: string[],
  libraryId: number
): Promise<BbtItemLinks[]> {
  const result = await rpc<unknown>(port, 'item.export', [
    citekeys,
    CSL_JSON_TRANSLATOR,
    libraryId,
  ]);
  const raw = Array.isArray(result) ? (result as string[])[2] : (result as string);
  const items = (JSON.parse(raw) as { items?: BbtExportItem[] }).items ?? [];

  const links: BbtItemLinks[] = [];
  for (const item of items) {
    const citekey = item.citekey || item.citationKey;
    if (!citekey) continue;
    const pdfPaths = (item.attachments ?? [])
      .map((a) => a.path)
      .filter((p: string | undefined): p is string => !!p && /\.pdf$/i.test(p));
    links.push({ citekey, select: item.select, pdfPaths });
  }
  return links;
}
