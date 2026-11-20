export interface DocRange {
  from: number;
  to: number;
}

/**
 * The part of a citation that its live preview widget replaces.
 *
 * In `[[@doe99]]` the citation's brackets are the inner halves of the
 * wikilink's `[[` and `]]`, which Obsidian hides with replace decorations of
 * its own. When CodeMirror redraws from inside a replaced range it treats any
 * replace decoration that started earlier as already drawn, so a widget
 * starting inside the hidden `[[` disappears. Keeping the widget on the link
 * text, between those decorations, avoids the overlap.
 */
export function citationWidgetRange(
  citation: DocRange,
  linkText?: DocRange
): DocRange {
  if (!linkText) return citation;

  return {
    from: Math.max(citation.from, linkText.from),
    to: Math.min(citation.to, linkText.to),
  };
}
