/* eslint-disable @typescript-eslint/ban-ts-comment */

import path from 'path';
import {
  bibToCSL,
  getCSLLocale,
  getCSLStyle,
  looksLikeXML,
} from '../helpers';
import which from 'which';

// @ts-ignore
import testCSL from './test.json';
// @ts-ignore
import testBIBCSL from './test.bib.json';
// @ts-ignore
import testBIB2CSL from './test2.bib.json';
// @ts-ignore
import testYAMLCSL from './test.yaml.json';
// @ts-ignore
// import library from './My Library.json';
import { existsSync, rmSync } from 'fs';

// The bibToCSL tests need a real pandoc; skip them where there isn't one.
const pandocPath = which.sync('pandoc', { nothrow: true }) as string;
const itWithPandoc = pandocPath ? it : it.skip;

describe('bibToCSL()', () => {
  it('returns json from json', async () => {
    expect(
      await bibToCSL(
        path.join(__dirname, 'test.json'),
        pandocPath
      )
    ).toEqual(testCSL);
  });

  itWithPandoc('returns json from bib', async () => {
    expect(
      await bibToCSL(
        path.join(__dirname, 'test.bib'),
        pandocPath
      )
    ).toEqual(testBIBCSL);
  });

  itWithPandoc('returns json from bib2', async () => {
    expect(
      await bibToCSL(
        path.join(__dirname, 'test2.bib'),
        pandocPath
      )
    ).toEqual(testBIB2CSL);
  });

  itWithPandoc('returns json from yaml', async () => {
    expect(
      await bibToCSL(
        path.join(__dirname, 'test.yaml'),
        pandocPath
      )
    ).toEqual(testYAMLCSL);
  });
});

// @ts-ignore
global.setImmediate =
  // @ts-ignore
  global.setImmediate || ((fn, ...args) => global.setTimeout(fn, 0, ...args));

describe('getLocale()', () => {
  it('fetches a locale', async () => {
    const cache = new Map<string, string>();
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValueOnce(true);
    const locale = await getCSLLocale(cache, __dirname, 'bg-BG');
    expect(typeof locale).toBe('string');
    expect(existsSync(path.join(__dirname, 'locales-bg-BG.xml'))).toBe(true);
    await getCSLLocale(cache, __dirname, 'bg-BG');
    rmSync(path.join(__dirname, 'locales-bg-BG.xml'));
  });
});

describe('getStyle()', () => {
  it('fetches a style', async () => {
    const cache = new Map<string, string>();
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValueOnce(true);
    const style = await getCSLStyle(
      cache,
      __dirname,
      'https://www.zotero.org/styles/australian-guide-to-legal-citation-3rd-edition'
    );
    expect(typeof style).toBe('string');
    expect(
      existsSync(
        path.join(__dirname, 'australian-guide-to-legal-citation-3rd-edition')
      )
    ).toBe(true);
    await getCSLStyle(
      cache,
      __dirname,
      'australian-guide-to-legal-citation-3rd-edition'
    );
    rmSync(
      path.join(__dirname, 'australian-guide-to-legal-citation-3rd-edition')
    );
  });
});

describe('looksLikeXML()', () => {
  it('accepts CSL styles and locales', () => {
    expect(looksLikeXML('<?xml version="1.0"?><style></style>')).toBe(true);
    expect(looksLikeXML('  \n<style xmlns="x">')).toBe(true);
    expect(looksLikeXML('<locale xml:lang="en">')).toBe(true);
  });

  it('rejects the 404 body GitHub serves for a renamed style', () => {
    expect(looksLikeXML('404: Not Found')).toBe(false);
    expect(looksLikeXML('')).toBe(false);
  });
});
