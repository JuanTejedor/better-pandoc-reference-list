export interface PartialCSLEntry {
  id: string;
  title: string;
  groupID?: number;
  /** Zotero item key, when the entry came from Zotero's local API. */
  zoteroKey?: string;
}

export type CSLList = PartialCSLEntry[];
