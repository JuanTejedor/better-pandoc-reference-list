import type { EditorView } from '@codemirror/view';
import type {
  Editor,
  EditorSuggest,
  MarkdownPreviewView,
  Menu,
  MenuItem,
  WorkspaceItem,
} from 'obsidian';

/**
 * Obsidian features this plugin relies on that are not in the public typings.
 * They are declared here, once, instead of being cast to `any` at each use.
 */

interface PreviewSection {
  el: HTMLElement;
  rendered: boolean;
}

export interface PreviewRenderer {
  lastText: string | null;
  sections: PreviewSection[];
  queueRender(): void;
}

export function getPreviewRenderer(
  previewMode: MarkdownPreviewView
): PreviewRenderer | undefined {
  return (previewMode as unknown as { renderer?: PreviewRenderer }).renderer;
}

/** The CodeMirror 6 view behind an editor. */
export function getEditorView(editor: Editor): EditorView | undefined {
  return (editor as unknown as { cm?: EditorView }).cm;
}

export interface SuggestPopup {
  suggestEl: HTMLElement;
  scope: {
    register(
      modifiers: string[],
      key: string,
      handler: (evt: KeyboardEvent) => boolean
    ): void;
  };
  suggestions?: {
    useSelectedItem(evt: KeyboardEvent): void;
    setSuggestions(items: unknown[]): void;
  };
}

export function asSuggestPopup<T>(suggest: EditorSuggest<T>): SuggestPopup {
  return suggest as unknown as SuggestPopup;
}

export interface SectionedMenu {
  addSections(sections: string[]): SectionedMenu;
  addItem(cb: (item: SectionedMenuItem) => void): SectionedMenu;
  onHide(cb: () => void): void;
  setParentElement(el: HTMLElement): {
    showAtPosition(pos: {
      x: number;
      y: number;
      width: number;
      overlap: boolean;
      left: boolean;
    }): void;
  };
}

export type SectionedMenuItem = MenuItem & { setSection(section: string): MenuItem };

export function asSectionedMenu(menu: Menu): SectionedMenu {
  return menu as unknown as SectionedMenu;
}

export function getRootSide(root: WorkspaceItem): string | undefined {
  return (root as unknown as { side?: string }).side;
}
