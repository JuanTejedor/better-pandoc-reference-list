import { execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import path from 'path';
import https from 'https';
import { PartialCSLEntry } from './types';

const execFileAsync = promisify(execFile);

export const DEFAULT_ZOTERO_PORT = '23119';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getBibPath(bibPath: string, getVaultRoot?: () => string) {
  if (!fs.existsSync(bibPath)) {
    const orig = bibPath;
    if (getVaultRoot) {
      bibPath = path.join(getVaultRoot(), bibPath);
      if (!fs.existsSync(bibPath)) {
        throw new Error(`bibToCSL: cannot access bibliography file '${bibPath}'.`);
      }
    } else {
      throw new Error(`bibToCSL: cannot access bibliography file '${orig}'.`);
    }
  }

  return bibPath;
}

export async function bibToCSL(
  bibPath: string,
  pathToPandoc: string,
  getVaultRoot?: () => string
): Promise<PartialCSLEntry[]> {
  bibPath = getBibPath(bibPath, getVaultRoot);

  const parsed = path.parse(bibPath);
  if (parsed.ext === '.json') {
    return new Promise((res, rej) => {
      fs.readFile(bibPath, (err, data) => {
        if (err) return rej(err);
        try {
          res(JSON.parse(data.toString()) as PartialCSLEntry[]);
        } catch (e) {
          rej(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
  }

  if (!pathToPandoc) {
    throw new Error('bibToCSL: path to pandoc is required for non CSL files.');
  }

  if (!fs.existsSync(pathToPandoc)) {
    throw new Error(`bibToCSL: cannot access pandoc at '${pathToPandoc}'.`);
  }

  const args = [bibPath, '-t', 'csljson', '--quiet'];

  // No shell involved: the path and arguments are passed to pandoc as-is
  const { stdout, stderr } = await execFileAsync(pathToPandoc, args, {
    maxBuffer: 256 * 1024 * 1024,
  });

  if (stderr) {
    throw new Error(`bibToCSL: ${stderr}`);
  }

  return JSON.parse(stdout) as PartialCSLEntry[];
}

function fetchText(url: string, what: string): Promise<string> {
  return new Promise((res, rej) => {
    https
      .get(url, (result) => {
        let output = '';
        result.setEncoding('utf8');
        result.on('data', (chunk) => (output += chunk));
        result.on('error', (e) => rej(new Error(`${what}: ${e}`)));
        result.on('end', () => {
          if (result.statusCode !== 200) {
            rej(new Error(`${what}: HTTP ${result.statusCode} for ${url}`));
          } else {
            res(output);
          }
        });
      })
      .on('error', (e) => rej(new Error(`${what}: ${e}`)));
  });
}

/**
 * CSL styles and locales are XML. GitHub answers a renamed/removed file with
 * the text "404: Not Found", which the original plugin cached as if it were a
 * style, breaking every citation until the file was deleted by hand.
 */
export function looksLikeXML(text: string) {
  return /^\s*(<\?xml|<style[\s>]|<locale[\s>])/.test(text);
}

function readValidCache(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file).toString();
  return looksLikeXML(text) ? text : null;
}

export async function getCSLLocale(
  localeCache: Map<string, string>,
  cacheDir: string,
  lang: string
) {
  if (localeCache.has(lang)) {
    return localeCache.get(lang);
  }

  const url = `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${lang}.xml`;
  const outpath = path.join(cacheDir, `locales-${lang}.xml`);

  ensureDir(cacheDir);
  const cachedLocale = readValidCache(outpath);
  if (cachedLocale) {
    localeCache.set(lang, cachedLocale);
    return cachedLocale;
  }

  const str = await fetchText(url, 'Downloading locale');
  if (!looksLikeXML(str)) {
    throw new Error(`Downloading locale: response for ${url} is not a CSL locale`);
  }

  fs.writeFileSync(outpath, str);
  localeCache.set(lang, str);
  return str;
}

export async function getCSLStyle(
  styleCache: Map<string, string>,
  cacheDir: string,
  url: string,
  explicitPath?: string
) {
  if (explicitPath) {
    if (styleCache.has(explicitPath)) {
      return styleCache.get(explicitPath);
    }

    if (!fs.existsSync(explicitPath)) {
      throw new Error(
        `Error: retrieving citation style; Cannot find file '${explicitPath}'.`
      );
    }

    const styleData = fs.readFileSync(explicitPath).toString();
    styleCache.set(explicitPath, styleData);
    return styleData;
  }

  if (styleCache.has(url)) {
    return styleCache.get(url);
  }

  const fileFromURL = url.split('/').pop();
  const outpath = path.join(cacheDir, fileFromURL);

  ensureDir(cacheDir);
  const cachedStyle = readValidCache(outpath);
  if (cachedStyle) {
    styleCache.set(url, cachedStyle);
    return cachedStyle;
  }

  const str = await fetchText(url, 'Error downloading CSL');
  if (!looksLikeXML(str)) {
    throw new Error(`Error downloading CSL: response for ${url} is not a CSL style`);
  }

  fs.writeFileSync(outpath, str);
  styleCache.set(url, str);
  return str;
}
