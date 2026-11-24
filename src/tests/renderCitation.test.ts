import { RenderedCitation } from '../parser/parser';
import { renderCitation } from '../renderCitation';

// Obsidian gives every element createSpan(); jsdom has none.
beforeAll(() => {
  HTMLElement.prototype.createSpan = function (
    this: HTMLElement,
    o?: DomElementInfo | string
  ) {
    const span = this.ownerDocument.createElement('span');
    const cls = typeof o === 'string' ? o : o?.cls;
    if (cls) span.className = Array.isArray(cls) ? cls.join(' ') : cls;
    return this.appendChild(span);
  };
});

const rendered = (props: Partial<RenderedCitation>): RenderedCitation => ({
  data: [],
  citations: [{ id: 'doe99' }],
  from: 0,
  to: 0,
  val: '',
  ...props,
});

const render = (props: Partial<RenderedCitation>) => {
  const el = document.createElement('span');
  renderCitation(el, rendered(props));
  return el;
};

describe('renderCitation()', () => {
  it('names the two forms of an author-in-text citation', () => {
    const el = render({
      mode: 'author-in-text',
      author: 'Doe',
      val: 'Doe (1999: 33)',
    });

    expect(el.dataset.citationMode).toBe('author-in-text');
    expect(el.innerHTML).toBe(
      '<span class="pandoc-citation-author-only">Doe</span> ' +
        '<span class="pandoc-citation-suppress-author">(1999: 33)</span>'
    );
  });

  it('keeps markup on both sides of the split', () => {
    const el = render({
      mode: 'author-in-text',
      author: '<i>Anon.</i>',
      val: '<i>Anon.</i><sup>2</sup>',
    });

    expect(el.innerHTML).toBe(
      '<span class="pandoc-citation-author-only"><i>Anon.</i></span>' +
        '<span class="pandoc-citation-suppress-author"><sup>2</sup></span>'
    );
  });

  it('adds no empty span when nothing follows the author', () => {
    const el = render({ mode: 'author-in-text', author: 'Doe', val: 'Doe' });

    expect(el.innerHTML).toBe(
      '<span class="pandoc-citation-author-only">Doe</span>'
    );
  });

  it('leaves a normal citation whole', () => {
    const el = render({ mode: 'normal-citation', val: '(Doe 1999: 33)' });

    expect(el.dataset.citationMode).toBe('normal-citation');
    expect(el.innerHTML).toBe('(Doe 1999: 33)');
  });

  it('leaves a suppress-author citation whole', () => {
    const el = render({ mode: 'suppress-author', val: '(1999: 33)' });

    expect(el.dataset.citationMode).toBe('suppress-author');
    expect(el.innerHTML).toBe('(1999: 33)');
  });

  it('leaves the value whole when it does not start with the author', () => {
    const el = render({
      mode: 'author-in-text',
      author: 'Doe',
      val: 'J. Doe (1999)',
    });

    expect(el.dataset.citationMode).toBe('author-in-text');
    expect(el.innerHTML).toBe('J. Doe (1999)');
  });

  it('sets no mode on a citation rendered without one', () => {
    const el = render({ val: '(Doe 1999)' });

    expect(el.dataset.citationMode).toBeUndefined();
    expect(el.textContent).toBe('(Doe 1999)');
  });
});
