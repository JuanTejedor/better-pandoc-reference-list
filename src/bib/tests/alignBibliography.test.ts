/* eslint-disable @typescript-eslint/ban-ts-comment */
import fs from 'fs';
import path from 'path';
import CSL from 'citeproc';
import { alignEntryIds, makeSuppressionProbe } from '../alignBibliography';

describe('alignEntryIds()', () => {
  it('zips when nothing is suppressed', () => {
    expect(alignEntryIds(['a', 'b'], 2, () => false)).toEqual(['a', 'b']);
  });

  it('skips suppressed ids so later entries keep the right citekey', () => {
    // ids a, i (suppressed), b -> two rendered entries
    expect(alignEntryIds(['a', 'i', 'b'], 2, (id) => id === 'i')).toEqual([
      'a',
      'b',
    ]);
  });

  it('refuses to guess when the counts still disagree', () => {
    expect(alignEntryIds(['a', 'b', 'c'], 1, () => false)).toEqual([null]);
  });
});

describe('with a real citeproc engine', () => {
  const style = fs.readFileSync(path.join(__dirname, 'suppress.csl'), 'utf8');
  const locale = fs.readFileSync(
    path.join(__dirname, '../../parser/tests/locale-en-US.xml'),
    'utf8'
  );
  const items: Record<string, any> = {
    zed: { id: 'zed', type: 'book', title: 'Zed book' },
    talk: { id: 'talk', type: 'interview', title: 'An interview' },
    alpha: { id: 'alpha', type: 'book', title: 'Alpha book' },
  };

  const createEngine = () =>
    new CSL.Engine(
      {
        retrieveLocale: () => locale,
        retrieveItem: (id: string) => items[id],
      },
      style,
      'en-US'
    );

  it('reproduces the length mismatch and realigns it', () => {
    const engine = createEngine();
    engine.updateItems(['zed', 'talk', 'alpha']);
    const [meta, entries] = engine.makeBibliography();
    const ids = meta.entry_ids.map((e: string[]) => e[0]);

    // the style sorts by title: Alpha, An interview, Zed
    expect(ids).toEqual(['alpha', 'talk', 'zed']);
    expect(entries).toHaveLength(2);

    const aligned = alignEntryIds(
      ids,
      entries.length,
      makeSuppressionProbe(createEngine)
    );

    expect(aligned).toEqual(['alpha', 'zed']);
    expect(entries[0]).toContain('Alpha book');
    expect(entries[1]).toContain('Zed book');
  });
});
