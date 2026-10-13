/** Deterministic fake-data generation from a JSON schema. Same seed -> same output. */
import type { JsonSchema } from './schema.ts';

export type Rng = () => number;

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara', 'Ken'];
const LAST = ['Lovelace', 'Torvalds', 'Hopper', 'Turing', 'Hamilton', 'Ritchie', 'Liskov', 'Thompson'];
const WORDS = ['amber', 'brisk', 'cobalt', 'delta', 'ember', 'fjord', 'gamma', 'harbor', 'indigo', 'juno'];

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const hex = (rng: Rng, n: number) => Array.from({ length: n }, () => int(rng, 0, 15).toString(16)).join('');

export function generate(schema: JsonSchema | undefined, rng: Rng, hint = '', depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.enum?.length) return pick(rng, schema.enum);
  if (schema.nullable && rng() < 0.1) return null;

  const type = schema.type ?? (schema.properties ? 'object' : schema.items ? 'array' : 'string');
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) out[key] = generate(sub, rng, key, depth + 1);
      return out;
    }
    case 'array':
      return Array.from({ length: int(rng, 1, 3) }, () => generate(schema.items, rng, hint, depth + 1));
    case 'integer':
      return int(rng, Math.ceil(schema.minimum ?? 1), Math.floor(schema.maximum ?? 1000));
    case 'number': {
      const min = schema.minimum ?? 0;
      return Math.round((min + rng() * ((schema.maximum ?? 1000) - min)) * 100) / 100;
    }
    case 'boolean':
      return rng() < 0.5;
    case 'null':
      return null;
    default:
      return generateString(schema, rng, hint.toLowerCase());
  }
}

function generateString(schema: JsonSchema, rng: Rng, hint: string): string {
  const fmt = schema.format;
  if (fmt === 'uuid') return `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-a${hex(rng, 3)}-${hex(rng, 12)}`;
  if (fmt === 'date-time' || fmt === 'date') {
    const iso = new Date(Date.UTC(2024, 0, 1) + int(rng, 0, 900) * 86_400_000).toISOString();
    return fmt === 'date' ? iso.slice(0, 10) : iso;
  }
  if (fmt === 'email' || hint.includes('email')) return `${pick(rng, FIRST)}.${pick(rng, LAST)}@example.com`.toLowerCase();
  if (fmt === 'uri' || hint.includes('url')) return `https://example.com/${pick(rng, WORDS)}/${int(rng, 1, 999)}`;
  if (hint.includes('name')) return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
  let s = `${pick(rng, WORDS)} ${pick(rng, WORDS)}`;
  if (schema.minLength && s.length < schema.minLength) s = s.padEnd(schema.minLength, 'x');
  if (schema.maxLength && s.length > schema.maxLength) s = s.slice(0, schema.maxLength);
  return s;
}
