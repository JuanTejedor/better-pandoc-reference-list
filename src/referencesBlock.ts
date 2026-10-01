export const DEFAULT_HEADING_LEVEL = 1;

/** Heading levels Markdown supports. */
export function clampHeadingLevel(level: unknown): number {
  const n = typeof level === 'number' ? Math.round(level) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_HEADING_LEVEL;
  return Math.min(6, Math.max(1, n));
}

/**
 * One reference as a single Markdown line. Numbered styles render a label
 * column and the text in separate blocks; joining them keeps "[1] Smith..."
 * together instead of splitting it over two paragraphs.
 */
export function referenceToLine(markdown: string): string {
  return markdown.replace(/\s*\n+\s*/g, ' ').trim();
}

/** The heading and the references below it, one paragraph per reference. */
export function buildReferencesBlock(
  level: unknown,
  title: string,
  references: string[]
): string {
  const lines = references.map(referenceToLine).filter((l) => l.length > 0);
  const heading = `${'#'.repeat(clampHeadingLevel(level))} ${title.trim()}`;
  return `${heading}\n\n${lines.join('\n\n')}\n`;
}

/**
 * Pads the block so it sits on its own lines when inserted mid-line: a blank
 * line before if the cursor follows text, and a newline after if more text
 * follows on the same line.
 */
export function placeBlock(
  block: string,
  textBeforeCursor: string,
  textAfterCursor: string
): string {
  const before = textBeforeCursor.trim().length > 0 ? '\n\n' : '';
  const after = textAfterCursor.trim().length > 0 ? '\n' : '';
  return `${before}${block}${after}`;
}
