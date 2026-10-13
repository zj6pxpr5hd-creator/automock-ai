/** The mock engine: (method, path, body) -> response. No HTTP in here, so it is trivial to test. */
import { generate, hashSeed, mulberry32 } from './generator.ts';
import { validate } from './contract.ts';
import { matchRoute } from './schema.ts';
import type { JsonSchema, Route } from './schema.ts';
import type { Store } from './state.ts';

export interface MockRequest {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  /** Force one of the spec's declared responses, e.g. 404 or 500 (header X-Mock-Status). */
  forceStatus?: number;
}

export interface MockResponse {
  status: number;
  body: unknown;
  /** Anything worth surfacing to Triage: contract violations, unmatched routes. */
  violations: string[];
}

const SEED_COUNT = 3;

export class MockEngine {
  routes: Route[];
  store: Store;

  constructor(routes: Route[], store: Store) {
    this.routes = routes;
    this.store = store;
    this.seed();
  }

  /** Populate each REST collection with deterministic fake rows (only if it is empty). */
  seed(): void {
    for (const route of this.routes) {
      const res = route.resource;
      if (!res || res.kind !== 'collection' || route.method !== 'GET') continue;
      if (this.store.count(res.name) > 0) continue;
      const schema = this.itemSchema(res.name);
      if (!schema) continue;
      for (let i = 1; i <= SEED_COUNT; i++) {
        const row = generate(schema, mulberry32(hashSeed(`${res.name}:${i}`))) as Record<string, unknown>;
        const idType = schema.properties?.id?.type ?? 'integer';
        row.id = idType === 'integer' ? i : String(row.id ?? i);
        this.store.put(res.name, String(row.id), row);
      }
    }
  }

  handle(req: MockRequest): MockResponse {
    const hit = matchRoute(this.routes, req.method, req.path);
    if (!hit) {
      const msg = `no route for ${req.method} ${req.path}`;
      return { status: 404, body: { error: 'no_route', message: msg }, violations: [msg] };
    }
    const { route, params } = hit;

    if (req.forceStatus !== undefined) {
      const schema = route.responses[String(req.forceStatus)];
      return { status: req.forceStatus, body: this.generated(route, schema), violations: [] };
    }

    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const errors = validate(req.body, route.requestSchema);
      if (errors.length) return { status: 400, body: { error: 'contract_violation', details: errors }, violations: errors };
    }

    if (route.resource) return this.handleResource(route, params, req);
    return { status: route.status, body: this.generated(route, route.responses[String(route.status)]), violations: [] };
  }

  private handleResource(route: Route, params: Record<string, string>, req: MockRequest): MockResponse {
    const { name, kind } = route.resource!;
    const id = params[route.params[0] ?? ''] ?? '';
    const ok = (status: number, body: unknown): MockResponse => ({ status, body, violations: [] });
    const notFound = (): MockResponse => ok(404, { error: 'not_found', id });

    if (kind === 'collection') {
      if (req.method === 'GET') return ok(route.status, this.store.list(name));
      if (req.method === 'POST') {
        const created = { ...(req.body as object), id: this.store.nextId(name) };
        this.store.put(name, String(created.id), created);
        return ok(route.status, created);
      }
    } else {
      const current = this.store.get(name, id);
      if (!current) return notFound();
      if (req.method === 'GET') return ok(route.status, current);
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const next = { ...(req.method === 'PATCH' ? current : {}), ...(req.body as object), id: current.id };
        this.store.put(name, id, next);
        return ok(route.status, next);
      }
      if (req.method === 'DELETE') {
        this.store.delete(name, id);
        return ok(route.status, null);
      }
    }
    return this.generated(route, route.responses[String(route.status)]) as never;
  }

  private generated(route: Route, schema: JsonSchema | undefined): unknown {
    return generate(schema, mulberry32(hashSeed(`${route.method} ${route.path}`)));
  }

  /** Item schema for a collection: array items of GET /name, else the response of GET /name/{id}. */
  private itemSchema(name: string): JsonSchema | undefined {
    const list = this.routes.find((r) => r.method === 'GET' && r.resource?.name === name && r.resource.kind === 'collection');
    const listSchema = list?.responses[String(list.status)];
    if (listSchema?.type === 'array' && listSchema.items) return listSchema.items;
    const item = this.routes.find((r) => r.method === 'GET' && r.resource?.name === name && r.resource.kind === 'item');
    return item?.responses[String(item.status)];
  }
}
