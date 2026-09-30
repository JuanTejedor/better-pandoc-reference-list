import type { App } from 'obsidian';

/**
 * The Obsidian `App` of this plugin instance. Set once in `onload`, from
 * `this.app`, so the code never relies on the deprecated global `app`.
 */
export let app: App;

export function setApp(instance: App) {
  app = instance;
}
