// helpers.ts resolves the locale once, on import, from Obsidian's language,
// so each test loads a fresh copy with getLanguage() mocked.
function loadHelpers(
  language: string,
  tables: Record<string, Record<string, string>> = {}
): typeof import('../lang/helpers') {
  jest.resetModules();
  jest.doMock('obsidian', () => ({ getLanguage: () => language }), {
    virtual: true,
  });
  for (const [file, table] of Object.entries(tables)) {
    jest.doMock(`../lang/locale/${file}`, () => ({
      __esModule: true,
      default: table,
    }));
  }
  return require('../lang/helpers');
}

const KEY = 'Citation style';

describe('t()', () => {
  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    error.mockRestore();
  });

  it('uses English for a regional English such as en-GB, without logging', () => {
    const { t } = loadHelpers('en-GB');
    expect(t(KEY)).toBe('Citation style');
    expect(error).not.toHaveBeenCalled();
  });

  it('falls back from a regional variant to its base language', () => {
    const { t } = loadHelpers('de-AT', { de: { [KEY]: 'Zitierstil' } });
    expect(t(KEY)).toBe('Zitierstil');
  });

  it('prefers the table for the exact variant when there is one', () => {
    const { t } = loadHelpers('pt-BR', {
      'pt-br': { [KEY]: 'Estilo de citação (BR)' },
      pt: { [KEY]: 'Estilo de citação (PT)' },
    });
    expect(t(KEY)).toBe('Estilo de citação (BR)');
  });

  it('uses English for a language with no table, without logging', () => {
    const { t } = loadHelpers('sv');
    expect(t(KEY)).toBe('Citation style');
    expect(error).not.toHaveBeenCalled();
  });
});
