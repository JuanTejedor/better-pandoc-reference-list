import { PartialCSLEntry } from './types';

/** The parts of citeproc-js this plugin uses. */
export interface CiteprocBibliographyMeta {
  entry_ids: string[][];
  bibstart: string;
  bibend: string;
}

export interface CiteprocBuildInfo {
  lang: string;
  langCache: Map<string, string>;
  style: string;
  styleCache: Map<string, string>;
  bibCache: Map<string, PartialCSLEntry>;
}

export interface CiteprocEngine {
  opt: {
    xclass: 'note' | 'in-text';
    development_extensions: { wrap_url_and_doi: boolean };
  };
  /** How this engine was built; lets us build an identical throwaway one. */
  prlBuild?: CiteprocBuildInfo;
  updateItems(ids: string[]): void;
  makeBibliography(): false | [CiteprocBibliographyMeta, string[]];
  rebuildProcessorState(
    cites: unknown[],
    format: string
  ): Array<[string, number, string]>;
  makeCitationCluster(items: unknown[]): string;
}

export interface CiteprocSys {
  retrieveLocale(id: string): string | undefined;
  retrieveItem(id: string): PartialCSLEntry | undefined;
}
