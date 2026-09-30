import type { CiteprocEngine } from './citeprocTypes';

/**
 * Some citation styles deliberately leave certain item types out of the
 * bibliography (e.g. Chicago author-date omits interviews and personal
 * communications). citeproc-js still lists those ids in `entry_ids`, but emits
 * no string for them, so `entry_ids[i]` and `entries[i]` stop lining up.
 *
 * Returns, for each rendered entry, the id it belongs to (or null when that
 * cannot be determined safely, in which case the entry is left untagged
 * rather than attributed to the wrong citekey).
 */
export function alignEntryIds(
  ids: string[],
  entryCount: number,
  isSuppressed: (id: string) => boolean
): Array<string | null> {
  if (ids.length === entryCount) return ids.slice();

  const kept = ids.filter((id) => !isSuppressed(id));
  if (kept.length !== entryCount) {
    return Array.from({ length: entryCount }, (): string | null => null);
  }
  return kept;
}

/**
 * Builds a predicate telling whether the style leaves an item out of the
 * bibliography, by rendering it alone in a throwaway engine. (The real engine
 * can't be used: probing it would disturb the citation state it is holding.)
 */
export function makeSuppressionProbe(
  createEngine: () => Pick<CiteprocEngine, 'updateItems' | 'makeBibliography'>
) {
  let probe: ReturnType<typeof createEngine> | undefined;
  const cache = new Map<string, boolean>();

  return (id: string): boolean => {
    const known = cache.get(id);
    if (known !== undefined) return known;
    let suppressed = false;
    try {
      probe = probe ?? createEngine();
      probe.updateItems([id]);
      const bib = probe.makeBibliography();
      suppressed = !bib || !bib[1].length;
    } catch (e) {
      console.error('Error probing bibliography entry', id, e);
    }
    cache.set(id, suppressed);
    return suppressed;
  };
}
