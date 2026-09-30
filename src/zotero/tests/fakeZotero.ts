import http from 'http';
import { AddressInfo } from 'net';

export interface FakeItem {
  key: string;
  /** Library version at which this item last changed. */
  version: number;
  citationKey?: string;
  title?: string;
  pdfKey?: string;
}

/**
 * A tiny stand-in for Zotero's local API and Better BibTeX endpoints, so sync
 * logic can be tested without a running Zotero.
 */
export class FakeZotero {
  server: http.Server;
  port = 0;
  libraryVersion = 10;
  items: FakeItem[] = [];
  groups: Array<{ id: number; name: string }> = [];
  localApiEnabled = true;
  bbtInstalled = false;
  /** Accept only BBT's new `library;id:N` export URL, like BBT 9. */
  bbtNumericIdBroken = true;
  /** Serve a cut-off JSON body from BBT export. */
  bbtTruncate = false;
  requests: string[] = [];
  /** Responses held back (to test single-flight). */
  delayMs = 0;

  constructor() {
    this.server = http.createServer((req, res) => {
      const url = req.url ?? '';
      this.requests.push(`${req.method} ${url}`);
      const respond = () => this.handle(req, res, url);
      if (this.delayMs) setTimeout(respond, this.delayMs);
      else respond();
    });
  }

  async start() {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop() {
    await new Promise<void>((r) => {
      this.server.close(() => r());
      (this.server as any).closeAllConnections?.();
    });
  }

  addItem(item: Partial<FakeItem> & { key: string }) {
    this.libraryVersion++;
    this.items.push({ version: this.libraryVersion, ...item });
  }

  touch(key: string, patch: Partial<FakeItem>) {
    this.libraryVersion++;
    const it = this.items.find((i) => i.key === key) as FakeItem;
    Object.assign(it, patch, { version: this.libraryVersion });
  }

  remove(key: string) {
    this.libraryVersion++;
    this.items = this.items.filter((i) => i.key !== key);
  }

  /** e.g. a PDF annotation: bumps the library version, changes no top item. */
  bumpVersionOnly() {
    this.libraryVersion++;
  }

  private csl(item: FakeItem) {
    const c: Record<string, unknown> = {
      id: item.citationKey ?? `http://zotero.org/users/1/items/${item.key}`,
      type: 'article-journal',
      title: item.title ?? `Title of ${item.key}`,
    };
    if (item.citationKey) c['citation-key'] = item.citationKey;
    return JSON.stringify([c], null, '\t');
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, url: string) {
    const u = new URL(url, 'http://x');
    const p = u.pathname;

    if (p.startsWith('/api/')) return this.handleApi(u, res);
    if (p === '/better-bibtex/cayw') {
      if (!this.bbtInstalled) return this.send(res, 404, 'nope');
      return this.send(res, 200, 'ready');
    }
    if (p === '/better-bibtex/json-rpc' && this.bbtInstalled) {
      return this.send(
        res,
        200,
        JSON.stringify({ jsonrpc: '2.0', result: [{ id: 1, name: 'My Library' }] })
      );
    }
    if (p.startsWith('/better-bibtex/export') && this.bbtInstalled) {
      const good = u.search.includes('library;id:1');
      if (this.bbtNumericIdBroken && !good) {
        return this.send(res, 404, "Could not export bibliography: library '/1/library.json' does not exist");
      }
      if (this.bbtTruncate) return this.send(res, 200, '[{"id":"smi');
      return this.send(
        res,
        200,
        JSON.stringify(
          this.items
            .filter((i) => i.citationKey)
            .map((i) => ({ id: i.citationKey, title: i.title ?? 'x', type: 'book' }))
        )
      );
    }
    this.send(res, 404, 'not found');
  }

  private handleApi(u: URL, res: http.ServerResponse) {
    if (!this.localApiEnabled) return this.send(res, 403, 'Local API is not enabled');
    const p = u.pathname;
    const q = u.searchParams;
    const headers = {
      'Last-Modified-Version': String(this.libraryVersion),
      'Content-Type': 'application/json',
    };

    if (p === '/api/users/0/groups') {
      return this.send(
        res,
        200,
        JSON.stringify(this.groups.map((g) => ({ id: g.id, data: { name: g.name } }))),
        headers
      );
    }

    const children = p.match(/^\/api\/users\/0\/items\/(\w+)\/children$/);
    if (children) {
      const parent = this.items.find((i) => i.key === children[1]);
      const kids = parent?.pdfKey
        ? [{ key: parent.pdfKey, data: { itemType: 'attachment', contentType: 'application/pdf' } }]
        : [];
      return this.send(res, 200, JSON.stringify(kids), headers);
    }

    if (p === '/api/users/0/items/top') {
      const since = Number(q.get('since') ?? 0);
      const limit = Number(q.get('limit') ?? 25);
      const start = Number(q.get('start') ?? 0);
      const matching = this.items.filter((i) => i.version > since);
      const page = matching.slice(start, start + limit);
      const h = { ...headers, 'Total-Results': String(matching.length) };
      if (q.get('format') === 'keys') {
        return this.send(res, 200, page.map((i) => i.key).join('\n'), h);
      }
      return this.send(
        res,
        200,
        JSON.stringify(page.map((i) => ({ key: i.key, version: i.version, csljson: this.csl(i) }))),
        h
      );
    }
    this.send(res, 404, 'not found', headers);
  }

  private send(
    res: http.ServerResponse,
    status: number,
    body: string,
    headers: Record<string, string> = {}
  ) {
    res.writeHead(status, headers);
    res.end(body);
  }
}
