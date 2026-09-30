import { parseShellPath, readShellPath } from '../shellPath';

describe('parseShellPath()', () => {
  it('extracts the PATH between the markers and ignores shell noise', () => {
    const out = 'Last login: today\nwelcome!\n__PRL_PATH__/usr/local/bin:/usr/bin__PRL_PATH__\nbye';
    expect(parseShellPath(out)).toBe('/usr/local/bin:/usr/bin');
  });

  it('returns null when the markers are missing or empty', () => {
    expect(parseShellPath('/usr/bin')).toBeNull();
    expect(parseShellPath('__PRL_PATH__/usr/bin')).toBeNull();
    expect(parseShellPath('__PRL_PATH____PRL_PATH__')).toBeNull();
  });
});

describe('readShellPath()', () => {
  it('runs the shell without a command string built from user input', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const path = await readShellPath((file, args, _opts, cb) => {
      calls.push({ file, args });
      cb(null, '__PRL_PATH__/opt/homebrew/bin__PRL_PATH__');
    });

    expect(path).toBe('/opt/homebrew/bin');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe('-ilc');
    expect(calls[0].args[1]).toContain('${PATH}');
  });

  it('resolves null when the shell fails', async () => {
    expect(await readShellPath((_f, _a, _o, cb) => cb(new Error('boom'), ''))).toBeNull();
  });
});
