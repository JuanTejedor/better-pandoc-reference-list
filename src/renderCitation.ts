import { RenderedCitation } from './parser/parser';

/**
 * Fills the element of a rendered citation, in the editor and in reading
 * view alike. The element records the citation's pandoc mode in
 * `data-citation-mode`: `author-in-text` (`@doe99`), `suppress-author`
 * (`[-@doe99]`) or `normal-citation` (`[@doe99]`).
 *
 * Pandoc renders an author-in-text citation as two citeproc items, the
 * author alone and the citation with the author suppressed, and each part
 * gets a span named for its form:
 *
 *   <span class="pandoc-citation-author-only">Doe</span>
 *   <span class="pandoc-citation-suppress-author">(1999: 33)</span>
 *
 * Whatever separates them, usually a space, stays between the spans.
 */
export function renderCitation(el: HTMLElement, cite: RenderedCitation) {
  const { mode, author, val } = cite;

  if (mode) el.dataset.citationMode = mode;

  if (mode === 'author-in-text' && author && val.startsWith(author)) {
    const after = val.slice(author.length);
    const space = /^\s*/.exec(after)[0];
    const rest = after.slice(space.length);

    appendHTML(el.createSpan({ cls: 'pandoc-citation-author-only' }), author);
    if (space) el.append(space);
    if (rest) {
      const cls = 'pandoc-citation-suppress-author';
      appendHTML(el.createSpan({ cls }), rest);
    }
  } else {
    appendHTML(el, val);
  }
}

function appendHTML(el: HTMLElement, html: string) {
  if (/</.test(html)) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    el.append(...Array.from(parsed.body.childNodes));
  } else {
    el.append(html);
  }
}
