import { execFile } from 'child_process';

const PATH_MARKER = '__PRL_PATH__';

/** Extracts the PATH printed between markers (login shells may print other noise). */
export function parseShellPath(stdout: string): string | null {
  const start = stdout.indexOf(PATH_MARKER);
  if (start === -1) return null;
  const from = start + PATH_MARKER.length;
  const end = stdout.indexOf(PATH_MARKER, from);
  if (end === -1) return null;
  return stdout.slice(from, end).trim() || null;
}

type ExecFile = (
  file: string,
  args: string[],
  options: { timeout: number },
  callback: (err: Error | null, stdout: string | { toString(): string }) => void
) => unknown;

export function readShellPath(
  exec: ExecFile = execFile
): Promise<string | null> {
  const shell = process.env.SHELL || '/bin/sh';
  return new Promise((resolve) => {
    exec(
      shell,
      ['-ilc', `printf '%s' "${PATH_MARKER}\${PATH}${PATH_MARKER}"`],
      { timeout: 5000 },
      (err, stdout) => resolve(err ? null : parseShellPath(String(stdout)))
    );
  });
}

/**
 * GUI apps on macOS and Linux don't inherit the PATH of the user's shell, so
 * tools like pandoc installed with Homebrew are not found. Ask a login shell.
 */
export async function fixPath(exec?: ExecFile) {
  if (process.platform === 'win32') {
    return;
  }

  const shellPath = await readShellPath(exec);
  process.env.PATH =
    shellPath ||
    [
      './node_modules/.bin',
      '/.nodebrew/current/bin',
      '/usr/local/bin',
      process.env.PATH,
    ].join(':');
}
