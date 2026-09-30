import fs from 'fs';
import os from 'os';
import path from 'path';
import { FakeZotero } from './fakeZotero';
import { ZoteroSync, ZoteroSyncSettings } from '../sync';
import { readCache, cachePath } from '../cache';
import { ZoteroUpdate } from '../types';

let zotero: FakeZotero;
let dir: string;
let settings: ZoteroSyncSettings;
let notices: string[];
let tasks: string[];
let updates: ZoteroUpdate[];
let sync: ZoteroSync;

function makeSync() {
  const s = new ZoteroSync({
    getSettings: () => settings,
    cacheDir: () => dir,
    notify: (m) => notices.push(m),
    startTask: (m) => {
      tasks.push(`start: ${m}`);
      return {
        update: (x) => tasks.push(`update: ${x}`),
        finish: (x) => tasks.push(`finish: ${x ?? ''}`),
      };
    },
  });
  s.onUpdate = (u) => updates.push(u);
  return s;
}

beforeEach(async () => {
  zotero = new FakeZotero();
  await zotero.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prl-test-'));
  notices = [];
  tasks = [];
  updates = [];
  settings = {
    port: String(zotero.port),
    source: 'auto',
    libraries: [{ id: 1, name: 'My Library' }],
  };
  sync = makeSync();
});

afterEach(async () => {
  sync.destroy();
  await zotero.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ids = (u: ZoteroUpdate) => u.entries.map((e) => e.id).sort();

describe('native provider', () => {
  it('imports the library on first sync and caches it', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    zotero.addItem({ key: 'BBBB2222', citationKey: 'jones2021', pdfKey: 'PDF00001' });

    expect(await sync.sync()).toBe(true);

    expect(sync.provider).toBe('native');
    expect(sync.status).toBe('idle');
    expect(ids(updates[0])).toEqual(['jones2021', 'smith2020']);
    expect(updates[0].entries[0].groupID).toBe(1);
    expect(updates[0].entries.find((e) => e.id === 'smith2020')?.zoteroKey).toBe('AAAA1111');
    expect(readCache(dir, 'native', 1)?.items).toHaveLength(2);
  });

  it('skips items that have no citation key', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    zotero.addItem({ key: 'NOKEY000' });

    await sync.sync();

    expect(ids(updates[0])).toEqual(['smith2020']);
  });

  it('does nothing when the library version has not changed', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();
    zotero.requests.length = 0;

    expect(await sync.sync()).toBe(false);

    expect(updates).toHaveLength(1);
    // one cheap version probe (plus connection probing), no item downloads
    expect(zotero.requests.filter((r) => r.includes('format=json'))).toHaveLength(0);
  });

  it('picks up newly added items incrementally (the original bug)', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();

    zotero.addItem({ key: 'BBBB2222', citationKey: 'newpaper2026' });
    zotero.requests.length = 0;
    expect(await sync.sync()).toBe(true);

    expect(ids(updates[1])).toEqual(['newpaper2026', 'smith2020']);
    const downloads = zotero.requests.filter((r) => r.includes('include=csljson'));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toContain('since=');
    expect(downloads[0]).not.toContain('since=0');
  });

  it('applies edits, including a changed citation key', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020', title: 'Old' });
    await sync.sync();

    zotero.touch('AAAA1111', { citationKey: 'smith2020a', title: 'New' });
    await sync.sync();

    expect(ids(updates[1])).toEqual(['smith2020a']);
    expect(updates[1].entries[0].title).toBe('New');
  });

  it('drops an item whose citation key was cleared', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    zotero.addItem({ key: 'BBBB2222', citationKey: 'jones2021' });
    await sync.sync();

    zotero.touch('AAAA1111', { citationKey: undefined });
    await sync.sync();

    expect(ids(updates[1])).toEqual(['jones2021']);
  });

  it('removes deleted items', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    zotero.addItem({ key: 'BBBB2222', citationKey: 'jones2021' });
    await sync.sync();

    zotero.remove('AAAA1111');
    await sync.sync();

    expect(ids(updates[1])).toEqual(['jones2021']);
  });

  it('ignores annotation-only version bumps without rewriting the cache', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();
    const file = cachePath(dir, 'native', 1);
    const before = fs.statSync(file).mtimeMs;

    zotero.bumpVersionOnly();
    expect(await sync.sync()).toBe(false);

    expect(fs.statSync(file).mtimeMs).toBe(before);
    // and the next real change is still found
    zotero.addItem({ key: 'BBBB2222', citationKey: 'jones2021' });
    expect(await sync.sync()).toBe(true);
    expect(ids(updates[1])).toEqual(['jones2021', 'smith2020']);
  });

  it('serves entries from disk while Zotero is down, then recovers', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();
    sync.destroy();

    // fresh plugin session, Zotero not started yet
    await zotero.stop();
    sync = makeSync();
    const cached = sync.loadCached();
    expect(cached && ids(cached)).toEqual(['smith2020']);

    expect(await sync.sync()).toBe(false);
    expect(sync.status).toBe('offline');
  });

  it('rebuilds when the cache is ahead of Zotero (e.g. copied from another machine)', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();
    // another machine's cache: a higher library version, and an item this Zotero doesn't have
    const cache = readCache(dir, 'native', 1) as NonNullable<ReturnType<typeof readCache>>;
    cache.version = 9999;
    cache.items.push({ key: 'GHOST000', version: 9000, csl: { id: 'ghost2099', title: 'x' } });
    fs.writeFileSync(cachePath(dir, 'native', 1), JSON.stringify(cache));
    sync.destroy();
    sync = makeSync();
    updates = [];
    sync.onUpdate = (u) => updates.push(u);

    expect(await sync.sync()).toBe(true);

    expect(ids(updates[0])).toEqual(['smith2020']);
    expect(readCache(dir, 'native', 1)?.version).toBe(zotero.libraryVersion);
  });

  it('shows progress for a large first import, and not for a small one', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();
    expect(tasks).toEqual([]);

    sync.destroy();
    sync = makeSync();
    fs.rmSync(dir, { recursive: true, force: true });
    for (let i = 0; i < 350; i++) {
      zotero.addItem({ key: `K${String(i).padStart(7, '0')}`, citationKey: `key${i}` });
    }

    await sync.sync();

    expect(tasks[0]).toMatch(/^start: Importing your Zotero library: 100 of 351/);
    expect(tasks.some((t) => t.startsWith('update: ') && t.includes('351 of 351'))).toBe(true);
    expect(tasks[tasks.length - 1]).toBe('finish: Zotero library imported: 351 items.');
  });

  it('keeps syncing when the progress display throws', async () => {
    for (let i = 0; i < 350; i++) {
      zotero.addItem({ key: `K${String(i).padStart(7, '0')}`, citationKey: `key${i}` });
    }
    sync.destroy();
    sync = new ZoteroSync({
      getSettings: () => settings,
      cacheDir: () => dir,
      notify: () => undefined,
      startTask: () => ({
        update: () => {
          throw new Error('ui broke');
        },
        finish: () => {
          throw new Error('ui broke');
        },
      }),
    });
    sync.onUpdate = (u) => updates.push(u);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await sync.sync()).toBe(true);

    expect(updates[0].entries).toHaveLength(350);
  });

  it('refuses malformed item keys and ports instead of building URLs from them', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();
    const tampered = { ...updates[0].entries[0], zoteroKey: '../../etc/passwd' };

    expect((await sync.getLinks([tampered])).size).toBe(0);

    settings.port = 'not-a-port';
    sync.destroy();
    sync = makeSync();
    expect(await sync.sync({ force: true })).toBe(false);
    expect(sync.status).toBe('offline');
  });

  it('shares one request between concurrent syncs', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    zotero.delayMs = 30;

    const [a, b] = await Promise.all([sync.sync(), sync.sync()]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(updates).toHaveLength(1);
    expect(zotero.requests.filter((r) => r.includes('include=csljson'))).toHaveLength(1);
  });

  it('throttles non-forced checks', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();
    zotero.addItem({ key: 'BBBB2222', citationKey: 'jones2021' });

    expect(await sync.sync({ minIntervalMs: 60000 })).toBe(false);
    expect(await sync.sync({ minIntervalMs: 60000, force: true })).toBe(true);
  });

  it('can rebuild from scratch', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();
    zotero.requests.length = 0;

    expect(await sync.sync({ rebuild: true })).toBe(true);

    const downloads = zotero.requests.filter((r) => r.includes('include=csljson'));
    expect(downloads[0]).toContain('since=0');
  });

  it('tolerates a corrupt cache file', async () => {
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    fs.writeFileSync(cachePath(dir, 'native', 1), '{"schema":1,"items":[');

    expect(sync.loadCached()).toBeNull();
    expect(await sync.sync()).toBe(true);
    expect(ids(updates[0])).toEqual(['smith2020']);
  });

  it('lists libraries including groups', async () => {
    zotero.groups = [{ id: 555, name: 'Lab group' }];
    expect(await sync.listLibraries()).toEqual([
      { id: 1, name: 'My Library' },
      { id: 555, name: 'Lab group' },
    ]);
  });

  it('builds Zotero select and PDF links', async () => {
    zotero.addItem({ key: 'BBBB2222', citationKey: 'jones2021', pdfKey: 'PDF00001' });
    await sync.sync();

    const links = await sync.getLinks(updates[0].entries);

    expect(links.get('jones2021')).toEqual({
      select: 'zotero://select/library/items/BBBB2222',
      pdfs: [{ url: 'zotero://open-pdf/library/items/PDF00001', label: 'PDF' }],
    });
  });
});

describe('provider fallback', () => {
  it('tells the user when the local API is off and BBT is absent', async () => {
    zotero.localApiEnabled = false;

    expect(await sync.sync()).toBe(false);

    expect(sync.status).toBe('error');
    expect(sync.lastError).toMatch(/not accepting connections/);
    expect(notices).toHaveLength(1);
    await sync.sync({ force: true });
    expect(notices).toHaveLength(1); // not repeated
  });

  it('falls back to Better BibTeX and uses the export URL BBT 9 accepts', async () => {
    zotero.localApiEnabled = false;
    zotero.bbtInstalled = true;
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });

    expect(await sync.sync()).toBe(true);

    expect(sync.provider).toBe('bbt');
    expect(ids(updates[0])).toEqual(['smith2020']);
    expect(zotero.requests.some((r) => r.includes('library;id:1'))).toBe(true);
  });

  it('does not let a truncated BBT export replace a good cache', async () => {
    zotero.localApiEnabled = false;
    zotero.bbtInstalled = true;
    zotero.addItem({ key: 'AAAA1111', citationKey: 'smith2020' });
    await sync.sync();

    zotero.bbtTruncate = true;
    zotero.addItem({ key: 'BBBB2222', citationKey: 'jones2021' });
    expect(await sync.sync({ force: true })).toBe(false);

    expect(sync.status).toBe('error');
    expect(readCache(dir, 'bbt', 1)?.items).toHaveLength(1);
    expect(ids(sync.loadCached() as ZoteroUpdate)).toEqual(['smith2020']);
  });

  it('honours source=native even when BBT is available', async () => {
    zotero.localApiEnabled = false;
    zotero.bbtInstalled = true;
    settings.source = 'native';

    expect(await sync.sync()).toBe(false);
    expect(sync.provider).toBeNull();
  });
});
