import {
  buildReferencesBlock,
  clampHeadingLevel,
  placeBlock,
  referenceToLine,
} from '../referencesBlock';

describe('clampHeadingLevel()', () => {
  it('keeps valid levels and falls back to 1 for nonsense', () => {
    expect(clampHeadingLevel(1)).toBe(1);
    expect(clampHeadingLevel(3)).toBe(3);
    expect(clampHeadingLevel(6)).toBe(6);
    expect(clampHeadingLevel(0)).toBe(1);
    expect(clampHeadingLevel(9)).toBe(6);
    expect(clampHeadingLevel(2.4)).toBe(2);
    expect(clampHeadingLevel(undefined)).toBe(1);
    expect(clampHeadingLevel('3')).toBe(1);
    expect(clampHeadingLevel(NaN)).toBe(1);
  });
});

describe('referenceToLine()', () => {
  it('joins a label column and its text on one line', () => {
    expect(referenceToLine('[1]\n\nSmith, J. (2020). *A book*.\n')).toBe(
      '[1] Smith, J. (2020). *A book*.'
    );
  });
});

describe('buildReferencesBlock()', () => {
  it('builds a heading of the chosen level with one paragraph per reference', () => {
    expect(
      buildReferencesBlock(2, 'References', ['Smith (2020).', 'Jones (2021).'])
    ).toBe('## References\n\nSmith (2020).\n\nJones (2021).\n');
  });

  it('defaults to a level 1 heading and trims the title', () => {
    expect(buildReferencesBlock(undefined, '  Bibliography ', ['A.'])).toBe(
      '# Bibliography\n\nA.\n'
    );
  });

  it('drops empty references', () => {
    expect(buildReferencesBlock(1, 'R', ['A.', '  \n ', 'B.'])).toBe(
      '# R\n\nA.\n\nB.\n'
    );
  });
});

describe('placeBlock()', () => {
  it('leaves an empty line as it is', () => {
    expect(placeBlock('# R\n', '', '')).toBe('# R\n');
  });

  it('starts a new paragraph when the cursor follows text', () => {
    expect(placeBlock('# R\n', 'Some text', '')).toBe('\n\n# R\n');
  });

  it('keeps following text on its own line', () => {
    expect(placeBlock('# R\n', '', 'more')).toBe('# R\n\n');
  });
});
