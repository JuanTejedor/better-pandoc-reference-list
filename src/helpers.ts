import { FileSystemAdapter, htmlToMarkdown } from 'obsidian';
import { app } from 'src/obsidianApp';

export function getVaultRoot() {
  // This is a desktop only plugin, so assume adapter is FileSystemAdapter
  return (app.vault.adapter as FileSystemAdapter).getBasePath();
}

interface ElectronApi {
  clipboard: { write(data: { html: string; text: string }): void };
  remote: {
    dialog: {
      showOpenDialogSync(options: {
        properties: string[];
      }): string[] | undefined;
    };
  };
}

// Obsidian's renderer exposes Electron through window.require
function getElectron() {
  return (window as unknown as { require(id: string): unknown }).require(
    'electron'
  ) as ElectronApi;
}

export function copyElToClipboard(el: HTMLElement) {
  getElectron().clipboard.write({
    html: el.outerHTML,
    text: htmlToMarkdown(el.outerHTML),
  });
}

/** Native "open file" dialog. Returns the chosen path, if any. */
export function pickFile(): string | undefined {
  const picked = getElectron().remote.dialog.showOpenDialogSync({
    properties: ['openFile'],
  });
  return picked?.[0];
}

export class PromiseCapability<T> {
  settled = false;
  promise: Promise<T>;
  resolve: (data: T) => void;
  reject: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = (data) => {
        resolve(data);
        this.settled = true;
      };

      this.reject = (reason) => {
        reject(
          reason instanceof Error
            ? reason
            : new Error(typeof reason === 'string' ? reason : 'Unknown error')
        );
        this.settled = true;
      };
    });
  }
}

export function areSetsEqual<T>(as: Set<T>, bs: Set<T>) {
  if (as.size !== bs.size) return false;
  for (const a of as) if (!bs.has(a)) return false;
  return true;
}
