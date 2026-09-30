import {
  Events,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  WorkspaceLeaf,
  debounce,
  setIcon,
} from 'obsidian';
import which from 'which';

import {
  citeKeyCacheField,
  citeKeyPlugin,
  bibManagerField,
  editorTooltipHandler,
} from './editorExtension';
import { t } from './lang/helpers';
import { processCiteKeys } from './markdownPostprocessor';
import {
  DEFAULT_SETTINGS,
  ReferenceListSettings,
  ReferenceListSettingsTab,
} from './settings';
import { TooltipManager } from './tooltip';
import { ReferenceListView, viewType } from './view';
import { PromiseCapability, getVaultRoot } from './helpers';
import { fixPath } from './shellPath';
import * as path from 'path';
import { BibManager } from './bib/bibManager';
import { setApp } from './obsidianApp';
import { asSectionedMenu } from './obsidianInternals';
import { CiteSuggest } from './citeSuggest/citeSuggest';

export default class ReferenceList extends Plugin {
  settings: ReferenceListSettings;
  emitter: Events;
  tooltipManager: TooltipManager;
  cacheDir: string;
  bibManager: BibManager;
  _initPromise: PromiseCapability<void>;

  get initPromise() {
    if (!this._initPromise) {
      return (this._initPromise = new PromiseCapability());
    }
    return this._initPromise;
  }

  async onload() {
    setApp(this.app);
    const { app } = this;

    await this.loadSettings();

    this.registerView(
      viewType,
      (leaf: WorkspaceLeaf) => new ReferenceListView(leaf, this)
    );

    this.cacheDir = path.join(getVaultRoot(), '.pandoc');
    this.emitter = new Events();
    this.bibManager = new BibManager(this);
    void this.initPromise.promise
      .then(() => {
        if (this.settings.pullFromZotero) {
          return this.bibManager.loadAndRefreshGlobalZBib();
        } else {
          return this.bibManager.loadGlobalBibFile();
        }
      })
      .finally(() => this.bibManager.initPromise.resolve());

    this.addSettingTab(new ReferenceListSettingsTab(this));
    this.registerEditorSuggest(new CiteSuggest(app, this));
    this.tooltipManager = new TooltipManager(this);
    this.registerMarkdownPostProcessor(processCiteKeys(this));
    this.registerEditorExtension([
      bibManagerField.init(() => this.bibManager),
      citeKeyCacheField,
      citeKeyPlugin,
      editorTooltipHandler(this.tooltipManager),
    ]);

    // No need to block execution
    void fixPath().then(async () => {
      if (!this.settings.pathToPandoc) {
        try {
          // Attempt to find if/where pandoc is located on the user's machine
          const pathToPandoc = await which('pandoc');
          this.settings.pathToPandoc = pathToPandoc;
          void this.saveSettings();
        } catch {
          // We can ignore any errors here
        }
      }

      this.initPromise.resolve();
      this.app.workspace.trigger('parse-style-settings');
    });

    this.addCommand({
      id: 'focus-reference-list-view',
      name: t('Show reference list'),
      callback: async () => {
        void this.initLeaf();
      },
    });

    this.addCommand({
      id: 'refresh-bibliography',
      name: t('Refresh bibliography'),
      callback: () => this.refreshBibliography(),
    });

    this.addCommand({
      id: 'rebuild-zotero-cache',
      name: t('Rebuild Zotero cache'),
      callback: () => this.refreshBibliography({ rebuild: true }),
    });

    // Switching back from Zotero is exactly when new references matter. The
    // check is one small request when nothing changed, and is throttled.
    this.registerDomEvent(window, 'focus', () => {
      if (!this.settings.pullFromZotero || !this.bibManager) return;
      void this.bibManager.refreshGlobalZBib({ minIntervalMs: 5000 });
    });

    this.bibManager.zsync.onStatus = () => this.updateZoteroStatus();

    document.body.toggleClass(
      'pwc-tooltips',
      !!this.settings.showCitekeyTooltips
    );

    this.registerEvent(
      app.metadataCache.on(
        'changed',
        debounce(
          async (file) => {
            await this.initPromise.promise;
            await this.bibManager.initPromise.promise;

            const activeView = app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView && file === activeView.file) {
              void this.processReferences();
            }
          },
          100,
          true
        )
      )
    );

    this.registerEvent(
      app.workspace.on(
        'active-leaf-change',
        debounce(
          async (leaf) => {
            await this.initPromise.promise;
            await this.bibManager.initPromise.promise;

            app.workspace.iterateRootLeaves((rootLeaf) => {
              if (rootLeaf === leaf) {
                if (leaf.view instanceof MarkdownView) {
                  void this.processReferences();
                } else {
                  this.view?.setNoContentMessage();
                }
              }
            });
          },
          100,
          true
        )
      )
    );

    void (async () => {
      this.initStatusBar();
      this.setStatusBarLoading();

      await this.initPromise.promise;
      await this.bibManager.initPromise.promise;

      this.setStatusBarIdle();
      void this.processReferences();
    })();
  }

  onunload() {
    document.body.removeClass('pwc-tooltips');
    this.bibManager.destroy();
  }

  statusBarIcon: HTMLElement;
  initStatusBar() {
    const ico = (this.statusBarIcon = this.addStatusBarItem());
    ico.addClass('pwc-status-icon', 'clickable-icon');
    ico.setAttr('aria-label', t('Pandoc reference list settings'));
    ico.setAttr('data-tooltip-position', 'top');
    this.setStatusBarIdle();
    let isOpen = false;
    ico.addEventListener('click', () => {
      if (isOpen) return;
      const { settings } = this;
      const menu = asSectionedMenu(new Menu())
        .addSections(['settings', 'actions'])
        .addItem((item) =>
          item
            .setSection('settings')
            .setIcon('lucide-message-square')
            .setTitle(t('Show citekey tooltips'))
            .setChecked(!!settings.showCitekeyTooltips)
            .onClick(() => {
              this.settings.showCitekeyTooltips = !settings.showCitekeyTooltips;
              void this.saveSettings();
            })
        )
        .addItem((item) =>
          item
            .setSection('settings')
            .setIcon('lucide-at-sign')
            .setTitle(t('Show citekey suggestions'))
            .setChecked(!!settings.enableCiteKeyCompletion)
            .onClick(() => {
              this.settings.enableCiteKeyCompletion =
                !settings.enableCiteKeyCompletion;
              void this.saveSettings();
            })
        )
        .addItem((item) =>
          item
            .setSection('actions')
            .setIcon('lucide-rotate-cw')
            .setTitle(t('Refresh bibliography'))
            .onClick(() => this.refreshBibliography())
        );

      const rect = ico.getBoundingClientRect();
      menu.onHide(() => {
        isOpen = false;
      });
      menu.setParentElement(ico).showAtPosition({
        x: rect.x,
        y: rect.top - 5,
        width: rect.width,
        overlap: true,
        left: false,
      });
      isOpen = true;
    });
  }

  /**
   * Re-reads the bibliography (Zotero or file). Unlike the old implementation,
   * a failed refresh keeps the existing entries instead of emptying them.
   */
  async refreshBibliography(opts: { rebuild?: boolean } = {}) {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      const file = activeView.file;
      if (this.bibManager.fileCache.has(file)) {
        const cache = this.bibManager.fileCache.get(file);
        if (cache.source !== this.bibManager) {
          // The note uses its own bibliography file
          this.bibManager.fileCache.delete(file);
          void this.processReferences();
          return;
        }
      }
    }

    if (this.settings.pullFromZotero) {
      const zsync = this.bibManager.zsync;
      const changed = await this.bibManager.refreshGlobalZBib({
        force: true,
        rebuild: opts.rebuild,
      });
      if (zsync.status === 'offline') {
        new Notice(t('Cannot connect to Zotero'));
      } else if (zsync.status === 'error') {
        new Notice(`Zotero: ${zsync.lastError}`, 10000);
      } else {
        new Notice(
          changed ? t('Bibliography updated') : t('Bibliography is up to date')
        );
      }
      void this.processReferences();
      return;
    }

    void this.bibManager.reinit(true);
    await this.bibManager.initPromise.promise;
    void this.processReferences();
  }

  updateZoteroStatus() {
    const ico = this.statusBarIcon;
    if (!ico) return;
    const { status, lastError } = this.bibManager.zsync;
    const problem = status === 'offline' || status === 'error';
    ico.toggleClass('pwc-status-warn', problem);
    ico.setAttr(
      'aria-label',
      problem
        ? `${t('Pandoc reference list settings')} — Zotero: ${lastError}`
        : t('Pandoc reference list settings')
    );
  }

  setStatusBarLoading() {
    this.statusBarIcon.addClass('is-loading');
    setIcon(this.statusBarIcon, 'lucide-loader');
  }

  setStatusBarIdle() {
    this.statusBarIcon.removeClass('is-loading');
    setIcon(this.statusBarIcon, 'lucide-at-sign');
  }

  /**
   * The live reference list view, if there is one. Since Obsidian 1.7 a leaf
   * restored at start-up holds a placeholder (DeferredView) until it is first
   * shown, so `leaf.view` is not necessarily ours: calling setViewContent on
   * it threw "setViewContent is not a function" (#127, #162).
   */
  get view(): ReferenceListView | null {
    const leaf = this.app.workspace
      .getLeavesOfType(viewType)
      .find((l) => l.view instanceof ReferenceListView);
    return leaf ? (leaf.view as ReferenceListView) : null;
  }

  async initLeaf() {
    const existing = this.app.workspace.getLeavesOfType(viewType);
    if (existing.length) {
      // Load a deferred leaf instead of opening a second pane
      await existing[0].loadIfDeferred();
      return this.revealLeaf();
    }

    await this.app.workspace.getRightLeaf(false).setViewState({
      type: viewType,
    });

    this.revealLeaf();

    await this.initPromise.promise;
    await this.bibManager.initPromise.promise;

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      void this.processReferences();
    }
  }

  revealLeaf() {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (!leaves?.length) return;
    void this.app.workspace.revealLeaf(leaves[0]);
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<ReferenceListSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  async saveSettings(cb?: () => void | Promise<void>) {
    document.body.toggleClass(
      'pwc-tooltips',
      !!this.settings.showCitekeyTooltips
    );

    // Refresh the reference list when settings change
    this.emitSettingsUpdate(cb);
    await this.saveData(this.settings);
  }

  emitSettingsUpdate = debounce(
    (cb?: () => void | Promise<void>) => {
      if (this.initPromise.settled) {
        this.view?.contentEl.toggleClass(
          'collapsed-links',
          !!this.settings.hideLinks
        );

        if (cb) void cb();

        void this.processReferences();
      }
    },
    5000,
    true
  );

  processReferences = async () => {
    const { settings, view } = this;
    if (!settings.pathToBibliography && !settings.pullFromZotero) {
      return view?.setMessage(
        t(
          'Please provide the path to your pandoc compatible bibliography file in the Pandoc Reference List plugin settings.'
        )
      );
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      try {
        const fileContent = await this.app.vault.cachedRead(activeView.file);
        const bib = await this.bibManager.getReferenceList(
          activeView.file,
          fileContent
        );
        const cache = this.bibManager.fileCache.get(activeView.file);

        const zstatus = this.bibManager.zsync.status;
        if (
          !bib &&
          cache?.source === this.bibManager &&
          settings.pullFromZotero &&
          (zstatus === 'offline' || zstatus === 'error') &&
          cache?.keys.size
        ) {
          view?.setMessage(
            zstatus === 'offline'
              ? t('Cannot connect to Zotero')
              : `Zotero: ${this.bibManager.zsync.lastError}`
          );
        } else {
          view?.setViewContent(bib);
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      view?.setNoContentMessage();
    }
  };
}
