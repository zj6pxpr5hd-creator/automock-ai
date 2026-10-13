/** Minimal JSON-schema validator + live-target contract verification. */
import type { JsonSchema, Route } from './schema.ts';

export function validate(value: unknown, schema: JsonSchema | undefined, path = '$'): string[] {
  if (!schema) return [];
  if (value === null) return schema.nullable || schema.type === 'null' ? [] : [`${path}: null not allowed`];
  const errors: string[] = [];

  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of ${JSON.stringify(schema.enum)}`);

  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected object`];
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}.${key}: required`);
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in obj) errors.push(...validate(obj[key], sub, `${path}.${key}`));
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) return [`${path}: expected array`];
      value.forEach((v, i) => errors.push(...validate(v, schema.items, `${path}[${i}]`)));
      break;
    case 'string':
      if (typeof value !== 'string') return [`${path}: expected string`];
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
      break;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || (schema.type === 'integer' && !Number.isInteger(value))) return [`${path}: expected ${schema.type}`];
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return [`${path}: expected boolean`];
      break;
  }
  return errors;
}

export interface VerifyResult {
  route: string;
  status: number | null;
  errors: string[];
}

/** Hit a real backend and check each parameter-free GET against the spec. */
export async function verifyTarget(
  routes: Route[],
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];
  for (const route of routes.filter((r) => r.method === 'GET' && r.params.length === 0)) {
    const label = `GET ${route.path}`;
    try {
      const res = await fetchImpl(new URL(route.path, baseUrl));
      const declared = route.responses[String(res.status)];
      const errors: string[] = [];
      if (!(String(res.status) in route.responses)) errors.push(`undeclared status ${res.status}`);
      else errors.push(...validate(await res.json().catch(() => undefined), declared));
      results.push({ route: label, status: res.status, errors });
    } catch (e) {
      results.push({ route: label, status: null, errors: [`request failed: ${(e as Error).message}`] });
    }
  }
  return results;
}
