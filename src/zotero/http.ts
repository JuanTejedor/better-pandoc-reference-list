import http from 'http';

export interface ZoteroResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Zotero isn't running, isn't listening on that port, or didn't answer in time. */
export class ZoteroUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZoteroUnreachableError';
  }
}

/** Zotero answered, but with an unexpected status. */
export class ZoteroHttpError extends Error {
  status: number;
  constructor(status: number, path: string, body: string) {
    super(`Zotero responded ${status} to ${path}: ${body.slice(0, 200)}`);
    this.name = 'ZoteroHttpError';
    this.status = status;
  }
}

export interface ZoteroRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string | number>;
  body?: string;
  /** Milliseconds before giving up. Default 15s. */
  timeout?: number;
}

const DEFAULT_TIMEOUT = 15000;

/**
 * Minimal localhost HTTP client. Resolves for *any* HTTP status so callers can
 * tell "Zotero said no" apart from "Zotero isn't there"; rejects only with
 * `ZoteroUnreachableError` for network failures and timeouts.
 */
export function zoteroRequest(
  port: string | number,
  path: string,
  opts: ZoteroRequestOptions = {}
): Promise<ZoteroResponse> {
  const { method = 'GET', headers = {}, body, timeout = DEFAULT_TIMEOUT } = opts;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const reqHeaders: Record<string, string | number> = {
      'User-Agent': 'obsidian/zotero',
      ...headers,
    };
    if (body !== undefined) {
      reqHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: reqHeaders },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('error', (e) =>
          finish(() => reject(new ZoteroUnreachableError(String(e))))
        );
        res.on('aborted', () =>
          finish(() =>
            reject(new ZoteroUnreachableError('connection closed mid-response'))
          )
        );
        res.on('end', () =>
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body,
            })
          )
        );
      }
    );

    timer = setTimeout(() => {
      finish(() => {
        req.destroy();
        reject(
          new ZoteroUnreachableError(`timed out after ${timeout}ms: ${path}`)
        );
      });
    }, timeout);

    req.on('error', (e) =>
      finish(() => reject(new ZoteroUnreachableError(String(e))))
    );

    if (body !== undefined) req.write(body);
    req.end();
  });
}

export function headerNumber(res: ZoteroResponse, name: string): number | null {
  const raw = res.headers[name.toLowerCase()];
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}
