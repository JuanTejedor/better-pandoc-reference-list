import { linkTargetShownAs } from '../markdownPostprocessor';

const link = (href: string) =>
  ({ getAttribute: () => href }) as unknown as HTMLElement;

describe('linkTargetShownAs()', () => {
  it('returns the target of a heading or block link showing its default text', () => {
    expect(linkTargetShownAs(link('@doe99#Intro'), '@doe99 > Intro')).toBe(
      '@doe99#Intro'
    );
    expect(linkTargetShownAs(link('@doe99#^abc'), '@doe99 > ^abc')).toBe(
      '@doe99#^abc'
    );
    expect(linkTargetShownAs(link('@doe99#A#B'), '@doe99 > A > B')).toBe(
      '@doe99#A#B'
    );
  });

  it('leaves links without a subpath or with an alias alone', () => {
    expect(linkTargetShownAs(link('@doe99'), '@doe99')).toBeNull();
    expect(linkTargetShownAs(link('@doe99#Intro'), 'Doe, 1999')).toBeNull();
  });
});
