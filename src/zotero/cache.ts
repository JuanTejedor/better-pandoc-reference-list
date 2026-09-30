import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LibraryCache, ZoteroProviderId } from './types';

export const CACHE_SCHEMA = 1;

export function cachePath(
  cacheDir: string,
  provider: ZoteroProviderId,
  libraryId: number
) {
  return path.join(cacheDir, `zotero-${provider}-${libraryId}.json`);
}

/**
 * Reads a library cache. Anything unreadable or from another schema is treated
 * as "no cache" rather than an error: a cache is an optimisation, and a corrupt
 * one must never prevent a fresh sync.
 */
export function readCache(
  cacheDir: string,
  provider: ZoteroProviderId,
  libraryId: number
): LibraryCache | null {
  const file = cachePath(cacheDir, provider, libraryId);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as LibraryCache;
    if (
      parsed?.schema !== CACHE_SCHEMA ||
      parsed.provider !== provider ||
      parsed.libraryId !== libraryId ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn(`Ignoring unreadable Zotero cache ${file}`, e);
    return null;
  }
}

/**
 * Writes via a temp file + rename so a crash, a full disk or a sync client
 * grabbing the file mid-write can never leave a truncated cache behind (that
 * produced "Unexpected end of JSON input" in the original plugin).
 */
export function writeCache(cacheDir: string, cache: LibraryCache) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = cachePath(cacheDir, cache.provider, cache.libraryId);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    throw e;
  }
}

/**
 * Where Zotero caches live: per machine and *outside* the vault.
 *
 * Inside the vault they are copied between computers by Drive/Dropbox/Sync,
 * which is wasteful (megabytes of JSON rewritten on every change) and wrong:
 * a cache records Zotero library versions of the machine that wrote it.
 */
export function zoteroCacheDir(
  vaultRoot: string,
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir()
) {
  let base: string;
  if (platform === 'win32') {
    base = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  } else if (platform === 'darwin') {
    base = path.join(home, 'Library', 'Caches');
  } else {
    base = env.XDG_CACHE_HOME || path.join(home, '.cache');
  }
  const vaultId = crypto
    .createHash('sha1')
    .update(path.resolve(vaultRoot))
    .digest('hex')
    .slice(0, 12);
  return path.join(base, 'better-pandoc-reference-list', vaultId);
}
