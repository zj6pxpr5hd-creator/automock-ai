import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { MockEngine } from '../src/engine/mock.ts';
import { loadSpec } from '../src/engine/schema.ts';
import { Store } from '../src/engine/state.ts';
import { createServer } from '../src/server.ts';

const store = new Store();
const server = createServer(
  new MockEngine(loadSpec(JSON.parse(readFileSync(new URL('../specs/petstore.json', import.meta.url), 'utf8'))), store),
  store,
);
let base = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('HTTP round-trip + request log + violations endpoint', async () => {
  const list = await fetch(`${base}/pets`);
  assert.equal(list.status, 200);
  assert.equal(((await list.json()) as unknown[]).length, 3);

  const bad = await fetch(`${base}/pets`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(bad.status, 400);

  const violations = (await (await fetch(`${base}/__automock/violations`)).json()) as { path: string }[];
  assert.equal(violations[0]?.path, '/pets');
});

test('malformed JSON gets a 400', async () => {
  assert.equal((await fetch(`${base}/pets`, { method: 'POST', body: '{nope' })).status, 400);
});
