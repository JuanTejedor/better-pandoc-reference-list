import path from 'path';
import { zoteroCacheDir } from '../cache';

describe('zoteroCacheDir()', () => {
  it('uses LOCALAPPDATA on Windows', () => {
    const dir = zoteroCacheDir('G:\My Drive\OBSIDIAN', 'win32', { LOCALAPPDATA: 'C:\Users\me\AppData\Local' }, 'C:\Users\me');
    expect(dir.startsWith(path.join('C:\Users\me\AppData\Local', 'better-pandoc-reference-list'))).toBe(true);
  });

  it('honours XDG_CACHE_HOME on Linux and falls back to ~/.cache', () => {
    expect(zoteroCacheDir('/v', 'linux', { XDG_CACHE_HOME: '/xdg' }, '/home/me')).toContain(path.join('/xdg', 'better-pandoc-reference-list'));
    expect(zoteroCacheDir('/v', 'linux', {}, '/home/me')).toContain(path.join('/home/me', '.cache'));
  });

  it('separates vaults so two vaults never share a cache', () => {
    const a = zoteroCacheDir('/vault/a', 'linux', {}, '/h');
    const b = zoteroCacheDir('/vault/b', 'linux', {}, '/h');
    expect(a).not.toBe(b);
    expect(zoteroCacheDir('/vault/a', 'linux', {}, '/h')).toBe(a);
  });
});
