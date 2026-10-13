/** OpenAPI (JSON, 3.x subset) -> list of Routes. Pure: no I/O, no HTTP. */

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  example?: unknown;
  nullable?: boolean;
  [key: string]: unknown;
}

export interface Route {
  method: string; // upper-case
  path: string; // as in the spec, e.g. /pets/{id}
  regex: RegExp;
  params: string[];
  requestSchema?: JsonSchema;
  responses: Record<string, JsonSchema | undefined>;
  status: number; // default success status
  /** Set when the path looks like REST: /things (collection) or /things/{id} (item). */
  resource?: { name: string; kind: 'collection' | 'item' };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export function loadSpec(doc: any): Route[] {
  const resolvePointer = (ref: string): any =>
    ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((node: any, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], doc);

  const deref = (node: any, refDepth = 0): any => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n) => deref(n, refDepth));
    if (typeof node.$ref === 'string') {
      if (refDepth > 8) return {}; // recursive schema guard
      return deref(resolvePointer(node.$ref), refDepth + 1);
    }
    const out: any = {};
    for (const [k, v] of Object.entries(node)) out[k] = deref(v, refDepth);
    return Array.isArray(out.allOf) ? mergeAllOf(out) : out;
  };

  const routes: Route[] = [];
  for (const [path, pathItem] of Object.entries<any>(doc.paths ?? {})) {
    for (const m of METHODS) {
      if (!pathItem?.[m]) continue;
      const op = deref(pathItem[m]);
      const method = m.toUpperCase();

      const responses: Route['responses'] = {};
      for (const [code, r] of Object.entries<any>(op.responses ?? {})) {
        responses[code] = r?.content?.['application/json']?.schema;
      }
      const success = Object.keys(responses).filter((c) => /^2\d\d$/.test(c)).sort()[0];
      const status = success ? Number(success) : method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;

      const params: string[] = [];
      const pattern = path
        .split('/')
        .map((seg) => {
          const p = /^\{(.+)\}$/.exec(seg);
          if (!p) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          params.push(p[1]!);
          return '([^/]+)';
        })
        .join('/');

      routes.push({
        method,
        path,
        regex: new RegExp(`^${pattern}/?$`),
        params,
        requestSchema: op.requestBody?.content?.['application/json']?.schema,
        responses,
        status,
        resource: inferResource(path),
      });
    }
  }
  // A path is only a stateful resource if the spec has real CRUD shape for it
  // (an item route, or a collection you can POST to). A lone GET /stats stays generated.
  const crud = new Set(
    routes
      .filter((r) => r.resource && (r.resource.kind === 'item' || r.method === 'POST'))
      .map((r) => r.resource!.name),
  );
  for (const r of routes) if (r.resource && !crud.has(r.resource.name)) delete r.resource;
  return routes;
}

export function matchRoute(
  routes: Route[],
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | undefined {
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.regex.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.params.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1]!)));
    return { route, params };
  }
  return undefined;
}

function inferResource(path: string): Route['resource'] {
  const segs = path.split('/').filter(Boolean);
  const isParam = (s: string) => /^\{.+\}$/.test(s);
  const params = segs.filter(isParam).length;
  const last = segs[segs.length - 1];
  if (!last) return undefined;
  if (!isParam(last) && params === 0) return { name: segs.join('/'), kind: 'collection' };
  const prev = segs[segs.length - 2];
  if (isParam(last) && params === 1 && prev && !isParam(prev)) {
    return { name: segs.slice(0, -1).join('/'), kind: 'item' };
  }
  return undefined; // nested/odd shapes fall back to schema-generated responses
}

function mergeAllOf(node: any): JsonSchema {
  const { allOf, ...rest } = node;
  const merged: any = { ...rest };
  for (const part of allOf as any[]) {
    merged.type ??= part.type;
    merged.properties = { ...merged.properties, ...part.properties };
    merged.required = [...(merged.required ?? []), ...(part.required ?? [])];
  }
  return merged;
}
