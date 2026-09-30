declare module 'delegate';
declare module 'citeproc' {
  import type {
    CiteprocEngine,
    CiteprocSys,
  } from 'src/bib/citeprocTypes';

  const CSL: {
    Engine: new (
      sys: CiteprocSys,
      style: string,
      lang?: string
    ) => CiteprocEngine;
    LANGS: Record<string, string>;
    LANG_BASES: Record<string, string>;
  };
  export default CSL;
}
