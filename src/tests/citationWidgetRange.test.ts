import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

import { DocRange, citationWidgetRange } from '../citationWidgetRange';

describe('citationWidgetRange()', () => {
  it('keeps the whole citation when it is not a link', () => {
    expect(citationWidgetRange({ from: 6, to: 14 })).toEqual({
      from: 6,
      to: 14,
    });
  });

  it('keeps a wikilink citation inside the link text', () => {
    // "Link: [[@doe99]]": the citation is [@doe99] (7-15), the link text
    // @doe99 (8-14).
    expect(
      citationWidgetRange({ from: 7, to: 15 }, { from: 8, to: 14 })
    ).toEqual({ from: 8, to: 14 });
  });

  it('never widens the citation past its own bounds', () => {
    expect(
      citationWidgetRange({ from: 8, to: 14 }, { from: 6, to: 16 })
    ).toEqual({ from: 8, to: 14 });
  });
});

describe('wikilink citation in live preview', () => {
  const doc = 'Link: [[@doe99]] end';
  const citation: DocRange = { from: 7, to: 15 };
  const linkText: DocRange = { from: 8, to: 14 };

  class CiteWidget extends WidgetType {
    eq() {
      return true;
    }

    toDOM() {
      const span = document.createElement('span');
      span.textContent = '(Doe, 1999)';
      return span;
    }
  }

  const showCitation = StateEffect.define<null>();

  /**
   * Mirrors Obsidian: its live preview hides the `[[` and `]]` first, and
   * the citation widget arrives later, once the citations are rendered.
   */
  function renderAfterLinkIsHidden(widget: DocRange) {
    const citationShown = StateField.define<boolean>({
      create: () => false,
      update: (shown, tr) =>
        shown || tr.effects.some((e) => e.is(showCitation)),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          citationShown,
          Prec.high(
            EditorView.decorations.of(
              Decoration.set([
                Decoration.replace({}).range(6, 8),
                Decoration.replace({}).range(14, 16),
              ])
            )
          ),
          EditorView.decorations.compute([citationShown], (state) =>
            state.field(citationShown)
              ? Decoration.set([
                  Decoration.replace({ widget: new CiteWidget() }).range(
                    widget.from,
                    widget.to
                  ),
                ])
              : Decoration.none
          ),
        ],
      }),
      parent: document.body,
    });

    view.dispatch({ effects: showCitation.of(null) });
    const text = view.contentDOM.textContent;
    view.destroy();
    return text;
  }

  it('loses the widget when it overlaps the hidden brackets', () => {
    // Guards the reproduction: without the fix the citation disappears.
    expect(renderAfterLinkIsHidden(citation)).toBe('Link:  end');
  });

  it('shows the rendered citation', () => {
    expect(
      renderAfterLinkIsHidden(citationWidgetRange(citation, linkText))
    ).toBe('Link: (Doe, 1999) end');
  });
});
