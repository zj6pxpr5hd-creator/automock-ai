/** Thin HTTP layer: parse request -> engine.handle -> write response. Plus the admin/dashboard API. */
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MockEngine } from './engine/mock.ts';
import type { Store } from './engine/state.ts';

const MAX_BODY = 1_000_000;

export function createServer(engine: MockEngine, store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = (req.method ?? 'GET').toUpperCase();

    if (url.pathname.startsWith('/__automock')) return admin(method, url, engine, store, res);

    let body: unknown;
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'invalid_json' });
    }

    const forced = Number(req.headers['x-mock-status']);
    const result = engine.handle({
      method,
      path: url.pathname,
      body,
      query: Object.fromEntries(url.searchParams),
      forceStatus: Number.isInteger(forced) && forced > 0 ? forced : undefined,
    });
    store.logRequest({ method, path: url.pathname, status: result.status, violations: result.violations });
    send(res, result.status, result.body);
  });
}

function admin(method: string, url: URL, engine: MockEngine, store: Store, res: ServerResponse): void {
  const sub = url.pathname.replace(/^\/__automock\/?/, '');
  if (sub === '') return sendRaw(res, 200, 'text/html; charset=utf-8', DASHBOARD);
  if (sub === 'health') return send(res, 200, { ok: true });
  if (sub === 'routes') {
    return send(res, 200, engine.routes.map((r) => ({ method: r.method, path: r.path, status: r.status, resource: r.resource?.name })));
  }
  if (sub === 'requests') return send(res, 200, store.recentRequests(Number(url.searchParams.get('limit') ?? 50)));
  if (sub === 'violations') return send(res, 200, store.recentRequests(100, true));
  if (sub === 'reset' && method === 'POST') {
    store.reset();
    engine.seed();
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: 'unknown_admin_endpoint' });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (status === 204 || body === null || body === undefined) return sendRaw(res, status, 'application/json', status === 204 ? '' : 'null');
  sendRaw(res, status, 'application/json', JSON.stringify(body));
}

function sendRaw(res: ServerResponse, status: number, type: string, payload: string): void {
  res.writeHead(status, { 'content-type': type });
  res.end(payload);
}

const DASHBOARD = `<!doctype html><meta charset="utf-8"><title>AutoMock AI</title>
<style>body{font:14px system-ui;margin:2rem;max-width:60rem}td,th{padding:.2rem .8rem;text-align:left}code{background:#eee;padding:0 .3rem}</style>
<h1>AutoMock AI</h1><h2>Routes</h2><table id="routes"></table>
<h2>Recent requests</h2><table id="reqs"></table>
<script>
const row=(t,cells)=>{const tr=t.insertRow();cells.forEach(c=>tr.insertCell().textContent=c)};
fetch('/__automock/routes').then(r=>r.json()).then(rs=>rs.forEach(r=>row(document.getElementById('routes'),[r.method,r.path,r.status,r.resource||''])));
fetch('/__automock/requests').then(r=>r.json()).then(rs=>rs.forEach(r=>row(document.getElementById('reqs'),[r.ts,r.method,r.path,r.status,r.violations.join('; ')])));
</script>`;
