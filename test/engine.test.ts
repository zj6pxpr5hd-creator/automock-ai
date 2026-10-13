import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validate } from '../src/engine/contract.ts';
import { generate, hashSeed, mulberry32 } from '../src/engine/generator.ts';
import { MockEngine } from '../src/engine/mock.ts';
import { loadSpec } from '../src/engine/schema.ts';
import { Store } from '../src/engine/state.ts';

const routes = loadSpec(JSON.parse(readFileSync(new URL('../specs/petstore.json', import.meta.url), 'utf8')));
const fresh = () => new MockEngine(routes, new Store());

test('spec parsing resolves $ref/allOf and infers REST resources', () => {
  const item = routes.find((r) => r.method === 'GET' && r.path === '/pets/{id}')!;
  assert.deepEqual(item.resource, { name: 'pets', kind: 'item' });
  assert.deepEqual(Object.keys(item.responses['200']!.properties!).sort(), ['id', 'name', 'ownerEmail', 'tag']);
});

test('collections are seeded deterministically', () => {
  const a = fresh().handle({ method: 'GET', path: '/pets' });
  const b = fresh().handle({ method: 'GET', path: '/pets' });
  assert.equal(a.status, 200);
  assert.equal((a.body as unknown[]).length, 3);
  assert.deepEqual(a.body, b.body);
});

test('seeded rows satisfy the response contract', () => {
  const item = routes.find((r) => r.method === 'GET' && r.path === '/pets/{id}')!;
  for (const row of fresh().handle({ method: 'GET', path: '/pets' }).body as unknown[]) {
    assert.deepEqual(validate(row, item.responses['200']), []);
  }
});

test('stateful CRUD round-trip', () => {
  const e = fresh();
  const created = e.handle({ method: 'POST', path: '/pets', body: { name: 'Rex', tag: 'dog' } });
  assert.equal(created.status, 201);
  const id = (created.body as { id: number }).id;
  assert.equal(id, 4);
  assert.equal((e.handle({ method: 'GET', path: `/pets/${id}` }).body as { name: string }).name, 'Rex');
  assert.equal(e.handle({ method: 'PUT', path: `/pets/${id}`, body: { name: 'Max' } }).status, 200);
  assert.equal((e.handle({ method: 'GET', path: `/pets/${id}` }).body as { name: string }).name, 'Max');
  assert.equal(e.handle({ method: 'DELETE', path: `/pets/${id}` }).status, 204);
  assert.equal(e.handle({ method: 'GET', path: `/pets/${id}` }).status, 404);
});

test('invalid request bodies are rejected and reported as violations', () => {
  const r = fresh().handle({ method: 'POST', path: '/pets', body: { tag: 'dragon' } });
  assert.equal(r.status, 400);
  assert.ok(r.violations.some((v) => v.includes('name: required')));
  assert.ok(r.violations.some((v) => v.includes('tag: not one of')));
});

test('unmatched routes return 404 and are flagged for triage', () => {
  const r = fresh().handle({ method: 'GET', path: '/nope' });
  assert.equal(r.status, 404);
  assert.equal(r.violations.length, 1);
});

test('forceStatus returns the declared error response', () => {
  assert.equal(fresh().handle({ method: 'GET', path: '/pets/1', forceStatus: 404 }).status, 404);
});

test('non-resource routes are generated from the schema', () => {
  const r = fresh().handle({ method: 'GET', path: '/stats' });
  assert.equal(r.status, 200);
  assert.deepEqual(validate(r.body, routes.find((x) => x.path === '/stats')!.responses['200']), []);
});

test('generator is deterministic per seed', () => {
  const schema = { type: 'object', properties: { email: { type: 'string' }, n: { type: 'integer' } } } as const;
  const g = () => generate(schema as never, mulberry32(hashSeed('x')));
  assert.deepEqual(g(), g());
});
