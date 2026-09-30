import CSL from 'citeproc';
import ReferenceList from 'src/main';
import { PartialCSLEntry } from './types';
import Fuse from 'fuse.js';
import {
  bibToCSL,
  getBibPath,
  getCSLLocale,
  getCSLStyle,
  DEFAULT_ZOTERO_PORT,
} from './helpers';
import { SyncOptions, ZoteroSync, ZoteroSyncHost } from 'src/zotero/sync';
import { ZoteroUpdate } from 'src/zotero/types';
import { zoteroCacheDir } from 'src/zotero/cache';
import {
  PromiseCapability,
  copyElToClipboard,
  getVaultRoot,
} from 'src/helpers';
import {
  RenderedCitation,
  getCitationSegments,
  getCitations,
} from 'src/parser/parser';
import LRUCache from 'lru-cache';
import { Keymap, MarkdownView, Notice, TFile, setIcon } from 'obsidian';
import { cite } from 'src/parser/citeproc';
import { setCiteKeyCache } from 'src/editorExtension';
import equal from 'fast-deep-equal';
import { t } from 'src/lang/helpers';
import { alignEntryIds, makeSuppressionProbe } from './alignBibliography';
import * as path from 'path';
import { FSWatcher, watch, existsSync } from 'fs';
import { app } from 'src/obsidianApp';
import type { CiteprocEngine } from './citeprocTypes';
import { getEditorView, getPreviewRenderer } from 'src/obsidianInternals';

const fuseSettings = {
  includeMatches: true,
  threshold: 0.35,
  minMatchCharLength: 2,
  keys: [
    { name: 'id', weight: 0.7 },
    { name: 'title', weight: 0.3 },
  ],
};

interface ScopedSettings {
  style?: string;
  lang?: string;
  bibliography?: string;
}

export interface FileCache {
  keys: Set<string>;
  resolvedKeys: Set<string>;
  unresolvedKeys: Set<string>;
  bib: HTMLElement;
  citations: RenderedCitation[];
  citeBibMap: Map<string, string>;

  settings: ScopedSettings | null;

  source: {
    bibCache?: Map<string, PartialCSLEntry>;
    fuse?: Fuse<PartialCSLEntry>;
    engine?: CiteprocEngine;
  };
}

function getScopedSettings(file: TFile): ScopedSettings {
  const metadata = app.metadataCache.getFileCache(file);
  const output: ScopedSettings = {};

  if (!metadata?.frontmatter) {
    return null;
  }

  const frontmatter = metadata.frontmatter as Record<string, unknown>;

  // Frontmatter is user-written YAML: a value may be a list or a number
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() || undefined : undefined;

  output.bibliography = text(frontmatter.bibliography);
  output.style = text(frontmatter.csl) || text(frontmatter['citation-style']);
  output.lang = text(frontmatter.lang) || text(frontmatter['citation-language']);

  if (Object.values(output).every((v) => !v)) {
    return null;
  }

  // Checks whether the bibliography is a relative path and replaces the path with an absolute one
  if (output.bibliography) {
    const besideNote = path.join(
      getVaultRoot(),
      path.dirname(file.path),
      output.bibliography
    );
    if (existsSync(besideNote)) output.bibliography = besideNote;
  }

  return output;
}

function extractRawLocales(style: string, localeName?: string) {
  const locales = ['en-US'];
  if (localeName) {
    locales.push(localeName);
  }
  if (style) {
    const matches = style.match(/locale="[^"]+"/g);
    if (matches) {
      for (const match of matches) {
        const vals = match.slice(0, -1).slice(8).split(/\s+/);
        for (const val of vals) {
          locales.push(val);
        }
      }
    }
  }
  return normalizeLocales(locales);
}

function normalizeLocales(locales: string[]) {
  const obj: Record<string, boolean> = {};
  for (let locale of locales) {
    locale = locale.split('-').slice(0, 2).join('-');
    if (CSL.LANGS[locale]) {
      obj[locale] = true;
    } else {
      locale = locale.split('-')[0];
      if (CSL.LANG_BASES[locale]) {
        locale = CSL.LANG_BASES[locale].split('_').join('-');
        obj[locale] = true;
      }
    }
  }
  return Object.keys(obj);
}

export class BibManager {
  plugin: ReferenceList;
  fileCache: LRUCache<TFile, FileCache>;
  initPromise: PromiseCapability<void>;

  langCache: Map<string, string> = new Map();
  styleCache: Map<string, string> = new Map();

  bibCache: Map<string, PartialCSLEntry> = new Map();
  fuse: Fuse<PartialCSLEntry>;
  engine: CiteprocEngine | null;

  zCitekeyToLinks: Map<string, string> = new Map();
  zCitekeyToPDFLinks: Map<string, Array<{ url: string; label: string }>> =
    new Map();

  watcherCache: Map<string, FSWatcher> = new Map();

  zsync: ZoteroSync;

  constructor(plugin: ReferenceList) {
    this.plugin = plugin;
    this.zsync = new ZoteroSync(this.zoteroHost());
    this.zsync.onUpdate = (update) => {
      void this.applyZoteroUpdate(update);
    };
    this.initPromise = new PromiseCapability();
    this.fileCache = new LRUCache({
      max: 10,
      noDisposeOnSet: true,
      dispose: (cache) => {
        if (cache.settings?.bibliography) {
          this.clearWatcher(cache.settings.bibliography);
        }
      },
    });
  }

  destroy() {
    this.zsync.destroy();
    this.fileCache.clear();

    for (const watcher of this.watcherCache.values()) {
      watcher.close();
    }

    this.watcherCache.clear();
    this.langCache.clear();
    this.styleCache.clear();
    this.bibCache.clear();
    this.fuse = null;
    this.engine = null;
    this.plugin = null;
  }

  clearWatcher(path: string) {
    if (this.watcherCache.has(path)) {
      this.watcherCache.get(path).close();
      this.watcherCache.delete(path);
    }
  }

  async reinit(clearCache: boolean) {
    this.initPromise = new PromiseCapability();
    this.fileCache.clear();
    if (clearCache) this.bibCache.clear();

    if (this.plugin.settings.pullFromZotero) {
      // Show what we already have straight away; the sync runs in the
      // background and re-renders when (and only if) something changed.
      await this.loadGlobalZBib();
      this.initPromise.resolve();
      void this.refreshGlobalZBib({ force: true });
      return;
    }

    await this.loadGlobalBibFile(true);
    this.initPromise.resolve();
  }

  setFuse(data: PartialCSLEntry[] = []) {
    if (!this.fuse) {
      this.fuse = new Fuse(data, fuseSettings);
    } else {
      this.fuse.setCollection(data);
    }
  }

  updateFuse(data: Map<string, PartialCSLEntry>) {
    if (!this.fuse) return;

    this.fuse.remove((doc) => {
      return data.has(doc.id);
    });

    for (const doc of data.values()) {
      this.fuse.add(doc);
    }
  }

  async loadScopedEngine(settings: ScopedSettings) {
    if (!settings) return this;

    const pluginSettings = this.plugin.settings;
    let style =
      pluginSettings.cslStyleURL ??
      'https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl';
    let lang = pluginSettings.cslLang ?? 'en-US';
    let bibCache = this.bibCache;
    let fuse = this.fuse;
    let langs = [settings.lang];

    if (settings.style) {
      try {
        const isURL = /^http/.test(settings.style);
        const styleObj = isURL
          ? { id: settings.style }
          : { id: settings.style, explicitPath: settings.style };
        const styles = await this.loadStyles([styleObj]);
        for (const styleStr of styles) {
          langs = extractRawLocales(styleStr, settings.lang);
        }
        style = settings.style;
      } catch (e) {
        console.error(e);
        return this;
      }
    }

    if (settings.lang) {
      try {
        await this.loadLangs(langs);
        lang = settings.lang;
      } catch (e) {
        console.error(e);
        return this;
      }
    }

    if (settings.bibliography) {
      try {
        const bib = await bibToCSL(
          settings.bibliography,
          this.plugin.settings.pathToPandoc,
          getVaultRoot
        );
        bibCache = new Map();

        for (const entry of bib) {
          bibCache.set(entry.id, entry);
        }

        fuse = new Fuse(bib, fuseSettings);
      } catch (e) {
        console.error(e);
        return this;
      }
    }

    try {
      const engine = this.buildEngine(
        lang,
        this.langCache,
        style,
        this.styleCache,
        bibCache
      );

      return {
        bibCache,
        fuse,
        engine,
      };
    } catch (e) {
      console.error(e);
      return this;
    }
  }

  async loadGlobalBibFile(fromCache?: boolean) {
    const { settings } = this.plugin;

    if (!settings.pathToBibliography) return;
    if (!fromCache || this.bibCache.size === 0) {
      const bib = await bibToCSL(
        settings.pathToBibliography,
        settings.pathToPandoc,
        getVaultRoot
      );

      this.bibCache = new Map();
      const bibPath = getBibPath(settings.pathToBibliography, getVaultRoot);

      if (bibPath && !this.watcherCache.has(bibPath)) {
        let dbTimer = 0;
        this.watcherCache.set(
          bibPath,
          watch(bibPath, (evt) => {
            if (evt === 'change') {
              window.clearTimeout(dbTimer);
              dbTimer = window.setTimeout(() => {
                void this.loadGlobalBibFile().then(() => {
                  this.fileCache.clear();
                  void this.plugin.processReferences();
                });
              }, 100);
            } else {
              this.clearWatcher(bibPath);
            }
          })
        );
      }

      for (const entry of bib) {
        this.bibCache.set(entry.id, entry);
      }

      this.setFuse(bib);
    }

    const style =
      settings.cslStylePath ||
      settings.cslStyleURL ||
      'https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl';
    const lang = settings.cslLang || 'en-US';

    await this.getLangAndStyle(lang, {
      id: style,
      explicitPath: settings.cslStylePath,
    });
    if (!this.styleCache.has(style)) return;

    try {
      this.engine = this.buildEngine(
        lang,
        this.langCache,
        style,
        this.styleCache,
        this.bibCache
      );
    } catch (e) {
      console.error(e);
    }
  }

  zoteroHost(): ZoteroSyncHost {
    return {
      getSettings: () => {
        const { zoteroPort, zoteroSource, zoteroGroups } = this.plugin.settings;
        return {
          port: zoteroPort || DEFAULT_ZOTERO_PORT,
          source: zoteroSource ?? 'auto',
          libraries: zoteroGroups ?? [],
        };
      },
      cacheDir: () => zoteroCacheDir(getVaultRoot()),
      notify: (message) => new Notice(message, 10000),
      startTask: (message) => {
        // duration 0: stays until we hide it, so a slow import can be read
        const notice = new Notice(message, 0);
        return {
          update: (m) => notice.setMessage(m),
          finish: (m) => {
            if (!m) return notice.hide();
            notice.setMessage(m);
            window.setTimeout(() => notice.hide(), 6000);
          },
        };
      },
    };
  }

  async loadAndRefreshGlobalZBib() {
    await this.loadGlobalZBib();
    // Deliberately not awaited: a slow first import must not block start-up.
    void this.refreshGlobalZBib({ force: true });
  }

  /** Loads the on-disk Zotero cache. Does not contact Zotero. */
  async loadGlobalZBib() {
    const cached = this.zsync.loadCached();
    await this.setZoteroEntries(cached?.entries ?? []);
  }

  /**
   * Checks Zotero for changes and, if there are any, applies them. Safe to
   * call often: concurrent calls share one request and unchanged libraries
   * cost a single tiny request.
   */
  refreshGlobalZBib(opts: SyncOptions = {}) {
    if (!this.plugin.settings.pullFromZotero) return Promise.resolve(false);
    return this.zsync.sync(opts);
  }

  private async applyZoteroUpdate(update: ZoteroUpdate) {
    await this.setZoteroEntries(update.entries);
    void this.plugin.processReferences();
  }

  private async setZoteroEntries(entries: PartialCSLEntry[]) {
    const { settings } = this.plugin;

    // Mutate in place: the citeproc engine holds a reference to this Map.
    this.bibCache.clear();
    for (const entry of entries) {
      this.bibCache.set(entry.id, entry);
    }
    this.setFuse(entries);

    // Links are keyed by citekey, which an edit in Zotero can reassign.
    this.zCitekeyToLinks.clear();
    this.zCitekeyToPDFLinks.clear();
    this.fileCache.clear();

    const style =
      settings.cslStylePath ||
      settings.cslStyleURL ||
      'https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl';
    const lang = settings.cslLang || 'en-US';

    await this.getLangAndStyle(lang, {
      id: style,
      explicitPath: settings.cslStylePath,
    });
    if (!this.styleCache.has(style)) return;

    try {
      // Rebuilt on every change: citeproc keeps its own copy of the items it
      // has already seen, so a long-lived engine would render stale metadata.
      this.engine = this.buildEngine(
        lang,
        this.langCache,
        style,
        this.styleCache,
        this.bibCache
      );
    } catch (e) {
      console.error(e);
    }
  }

  buildEngine(
    lang: string,
    langCache: Map<string, string>,
    style: string,
    styleCache: Map<string, string>,
    bibCache: Map<string, PartialCSLEntry>
  ) {
    const styleXML = styleCache.get(style);
    if (!styleXML) {
      throw new Error(
        'attempting to build citproc engine with empty CSL style'
      );
    }
    if (!langCache.get(lang)) {
      throw new Error(
        'attempting to build citproc engine with empty CSL locale'
      );
    }
    const engine = new CSL.Engine(
      {
        retrieveLocale: (id: string) => {
          return langCache.get(id);
        },
        retrieveItem: (id: string) => {
          return bibCache.get(id);
        },
      },
      styleXML,
      lang
    );
    engine.opt.development_extensions.wrap_url_and_doi = true;
    engine.prlBuild = { lang, langCache, style, styleCache, bibCache };
    return engine;
  }

  /** A fresh engine with the same style, locale and items as `engine`. */
  buildProbeEngine(engine: CiteprocEngine) {
    const b = engine.prlBuild;
    return this.buildEngine(
      b.lang,
      b.langCache,
      b.style,
      b.styleCache,
      b.bibCache
    );
  }

  async getLangAndStyle(
    lang: string,
    style: { id: string; explicitPath?: string }
  ) {
    let styles: string[] = [];
    if (!this.styleCache.has(style.id)) {
      try {
        styles = await this.loadStyles([style]);
      } catch (e) {
        console.error('Error loading style', style, e);
        this.initPromise.resolve();
        return;
      }
    }

    let locales = [lang];
    for (const styleStr of styles) {
      locales = extractRawLocales(styleStr, lang);
    }

    try {
      await this.loadLangs(locales);
    } catch (e) {
      console.error('Error loading lang', lang, e);
      this.initPromise.resolve();
      return;
    }
  }

  async loadLangs(langs: string[]) {
    for (const lang of langs) {
      if (!lang) continue;
      if (!this.langCache.has(lang)) {
        await getCSLLocale(this.langCache, this.plugin.cacheDir, lang);
      }
    }
  }

  async loadStyles(styles: { id?: string; explicitPath?: string }[]) {
    const res: string[] = [];
    for (const style of styles) {
      if (!style.id && !style.explicitPath) continue;
      if (!this.styleCache.has(style.explicitPath ?? style.id)) {
        res.push(
          await getCSLStyle(
            this.styleCache,
            this.plugin.cacheDir,
            style.id,
            style.explicitPath
          )
        );
      }
    }
    return res;
  }

  getNoteForNoteIndex(file: TFile, index: string) {
    if (!this.fileCache.has(file)) {
      return null;
    }

    const cache = this.fileCache.get(file);
    const noteIndex = parseInt(index);

    const cite = cache.citations.find((c) => c.noteIndex === noteIndex);

    if (!cite.note) {
      return null;
    }

    const doc = new DOMParser().parseFromString(cite.note, 'text/html');
    return Array.from(doc.body.childNodes);
  }

  getBibForCiteKey(file: TFile, key: string) {
    if (!this.fileCache.has(file)) {
      return null;
    }

    const cache = this.fileCache.get(file);
    if (!cache.keys.has(key)) {
      return null;
    }

    const html = cache.citeBibMap.get(key);
    if (!html) {
      return null;
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.body.firstElementChild as HTMLElement;
    if (el) {
      el.dataset.citekey = key;
      return this.prepBibHTML(el, file, true);
    }
    return el;
  }

  async getReferenceList(file: TFile, content: string) {
    await this.plugin.initPromise.promise;
    await this.initPromise.promise;

    const segs = getCitationSegments(
      content,
      !this.plugin.settings.renderLinkCitations
    );
    const processed = segs.map((s) => getCitations(s));

    if (!processed.length) return null;

    const citeKeys = new Set<string>();
    const unresolvedKeys = new Set<string>();
    const resolvedKeys = new Set<string>();
    const cachedDoc = this.fileCache.has(file)
      ? this.fileCache.get(file)
      : null;
    const citeBibMap = new Map<string, string>();
    const settings = getScopedSettings(file);

    processed.forEach((p) =>
      p.citations.forEach((c) => {
        if (c.id && !citeKeys.has(c.id)) {
          citeKeys.add(c.id);
        }
      })
    );

    const areSettingsEqual =
      settings?.bibliography === cachedDoc?.settings?.bibliography &&
      settings?.style === cachedDoc?.settings?.style &&
      settings?.lang === cachedDoc?.settings?.lang;

    if (!areSettingsEqual && cachedDoc?.settings?.bibliography) {
      this.clearWatcher(cachedDoc.settings.bibliography);
    }

    const source =
      cachedDoc?.source && areSettingsEqual
        ? cachedDoc.source
        : await this.loadScopedEngine(settings);

    if (settings?.bibliography) {
      const bibPath = getBibPath(settings.bibliography, getVaultRoot);
      if (!this.watcherCache.has(bibPath)) {
        let dbTimer = 0;
        this.watcherCache.set(
          bibPath,
          watch(bibPath, (evt) => {
            if (evt === 'change') {
              window.clearTimeout(dbTimer);
              dbTimer = window.setTimeout(() => {
                this.fileCache.delete(file);
                void this.plugin.processReferences();
              }, 100);
            } else {
              this.clearWatcher(bibPath);
            }
          })
        );
      }
    }

    const setNull = (): null => {
      const result: FileCache = {
        keys: citeKeys,
        resolvedKeys,
        unresolvedKeys,
        bib: null,
        citations: [],
        citeBibMap,
        settings: null,
        source,
      };

      this.fileCache.set(file, result);
      this.dispatchResult(file, result);

      return null;
    };

    if (!source?.engine) {
      return setNull();
    }

    citeKeys.forEach((k) => {
      if (source.bibCache.has(k)) {
        resolvedKeys.add(k);
      } else {
        unresolvedKeys.add(k);
      }
    });

    const filtered = processed.filter((s) =>
      s.citations.every((c) => {
        const resolved = source.bibCache.has(c.id);
        if (resolved) {
          resolvedKeys.add(c.id);
        } else {
          unresolvedKeys.add(c.id);
        }
        return resolved;
      })
    );

    // Do we need this?
    // source.engine.updateItems(Array.from(resolvedKeys));

    const citations = cite(source.engine, filtered);

    if (
      cachedDoc &&
      equal(cachedDoc.citations, citations) &&
      areSettingsEqual
    ) {
      return cachedDoc.bib;
    }

    const bib = source.engine.makeBibliography();

    if (!bib) {
      return setNull();
    }

    const metadata = bib[0];
    const entries = bib[1];
    const htmlStr = [metadata.bibstart];

    if (metadata.entry_ids?.length) {
      const entryIds = alignEntryIds(
        metadata.entry_ids.map((e: string[]) => e[0]),
        entries.length,
        makeSuppressionProbe(() => this.buildProbeEngine(source.engine))
      );
      entryIds.forEach((id, i) => {
        if (!id) return;
        entries[i] = entries[i].replace(/>/, ` data-citekey="${id}">`);
        citeBibMap.set(id, entries[i]);
      });
    }

    for (const entry of entries) htmlStr.push(entry);

    htmlStr.push(metadata.bibend);
    let parsed = entries.length
      ? (new DOMParser().parseFromString(htmlStr.join(''), 'text/html').body
          .firstElementChild as HTMLElement)
      : null;

    if (parsed) {
      if (this.plugin.settings.pullFromZotero && !settings?.bibliography) {
        await this.getZLinksForKeys(resolvedKeys);
      }
      parsed = this.prepBibHTML(parsed, file);
    }

    const result: FileCache = {
      keys: citeKeys,
      resolvedKeys,
      unresolvedKeys,
      bib: parsed,
      citations,
      citeBibMap,
      settings,
      source,
    };

    this.fileCache.set(file, result);
    this.dispatchResult(file, result);

    return result.bib;
  }

  async getZLinksForKeys(citekeys: Set<string>) {
    const missing: PartialCSLEntry[] = [];

    citekeys.forEach((key) => {
      if (this.zCitekeyToLinks.has(key) || this.zCitekeyToPDFLinks.has(key)) {
        return;
      }
      const entry = this.bibCache.get(key);
      if (entry && entry.groupID !== undefined) missing.push(entry);
    });

    if (!missing.length) return;

    const links = await this.zsync.getLinks(missing);
    for (const [key, link] of links) {
      if (link.select) this.zCitekeyToLinks.set(key, link.select);
      if (link.pdfs.length) this.zCitekeyToPDFLinks.set(key, link.pdfs);
    }
  }

  prepBibHTML(parsed: HTMLElement, file: TFile, inTooltip?: boolean) {
    if (this.plugin.settings.hideLinks) {
      parsed?.findAll('a').forEach((l) => {
        l.setAttribute('aria-label', l.innerText);
      });
    }

    if (parsed?.hasClass('csl-entry')) {
      const entry = parsed;
      parsed = createDiv();
      parsed.append(entry);
    }

    parsed?.findAll('.csl-entry').forEach((e) => {
      // Numbered styles render a label column next to the entry text
      if (e.querySelector(':scope > div + div')) e.addClass('pwc-entry-columns');

      if (!inTooltip) {
        e.setAttribute('aria-label', t('Click to copy'));
        e.onClickEvent(() => copyElToClipboard(e));
      }

      const div = createDiv({ cls: 'csl-entry-wrapper' });
      e.parentElement.insertBefore(div, e);
      div.append(e);

      if (e.dataset.citekey) {
        const zLink = this.zCitekeyToLinks.get(e.dataset.citekey);
        const zPDFLinks = this.zCitekeyToPDFLinks.get(e.dataset.citekey);
        let linkText = '@' + e.dataset.citekey;
        let linkDest = app.metadataCache.getFirstLinkpathDest(
          linkText,
          file.path
        );
        if (!linkDest) {
          linkText = e.dataset.citekey;
          linkDest = app.metadataCache.getFirstLinkpathDest(
            linkText,
            file.path
          );
        }

        if (!linkDest && !zLink && !zPDFLinks) return;

        div.createDiv({ cls: 'pwc-entry-btns' }, (div) => {
          if (linkDest) {
            div.createDiv('clickable-icon', (div) => {
              setIcon(div, 'sticky-note');
              div.setAttr('aria-label', t('Open literature note'));
              div.onClickEvent((e) => {
                const newPane = Keymap.isModEvent(e);
                void app.workspace.openLinkText(linkText, file.path, newPane);
              });
            });
          }
          if (zLink) {
            div.createDiv('clickable-icon', (div) => {
              setIcon(div, 'lucide-external-link');
              div.setAttr('aria-label', t('Open in Zotero'));
              div.onClickEvent(() => {
                activeWindow.open(zLink, '_blank');
              });
            });
          }
          if (zPDFLinks) {
            zPDFLinks.forEach((link) => {
              div.createDiv('clickable-icon', (div) => {
                setIcon(div, 'lucide-file-text');
                div.setAttr('aria-label', link.label);
                div.onClickEvent(() => {
                  activeWindow.open(link.url, '_blank');
                });
              });
            });
          }
        });
      }
    });

    return parsed;
  }

  dispatchResult(file: TFile, result: FileCache) {
    app.workspace.getLeavesOfType('markdown').forEach((l) => {
      const view = l.view as MarkdownView;
      if (view.file === file) {
        const renderer = getPreviewRenderer(view.previewMode);
        if (renderer) {
          renderer.lastText = null;
          for (const section of renderer.sections) {
            if (
              !section.el.hasClass('mod-header') &&
              !section.el.hasClass('mod-footer')
            ) {
              section.rendered = false;
              section.el.empty();
            }
          }
          renderer.queueRender();
        }

        const cm = getEditorView(view.editor);
        if (cm?.dispatch) {
          cm.dispatch({
            effects: [setCiteKeyCache.of(result)],
          });
        }
      }
    });
  }

  getCacheForPath(filePath: string) {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (file && file instanceof TFile && this.fileCache.has(file)) {
      const cache = this.fileCache.get(file);
      return cache;
    }

    return null;
  }

  getResolution(filePath: string, key: string) {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (file && file instanceof TFile && this.fileCache.has(file)) {
      const cache = this.fileCache.get(file);
      return {
        isResolved: cache.resolvedKeys.has(key),
        isUnresolved: cache.unresolvedKeys.has(key),
      };
    }

    return {
      isResolved: false,
      isUnresolved: false,
    };
  }

  getCitationsForSection(filePath: string, lineStart: number, lineEnd: number) {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (file && file instanceof TFile && this.fileCache.has(file)) {
      const cache = this.fileCache.get(file);
      const mCache = app.metadataCache.getCache(filePath);

      const section = mCache.sections?.find(
        (s) =>
          s.position.start.line === lineStart && s.position.end.line === lineEnd
      );

      if (!section) return [];

      const startOffset = section.position.start.offset;
      const endOffset = section.position.end.offset;

      const cites = cache.citations.filter(
        (c) => c.from >= startOffset && c.to <= endOffset
      );
      return cites;
    }

    return [];
  }
}
