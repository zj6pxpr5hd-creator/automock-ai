import { mkdirSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { verifyTarget } from './engine/contract.ts';
import { MockEngine } from './engine/mock.ts';
import { loadSpec } from './engine/schema.ts';
import { Store } from './engine/state.ts';
import { createServer } from './server.ts';

const USAGE = `automock <command> <spec.json> [options]
  serve   <spec> [--port 4010] [--db data/automock.db]   run the mock server
  routes  <spec>                                          list routes parsed from the spec
  verify  <spec> --target <baseUrl>                       check a real backend against the spec`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '4010' },
    db: { type: 'string', default: 'data/automock.db' },
    target: { type: 'string' },
  },
});

const [command, specPath] = positionals;
if (!command || !specPath) {
  console.error(USAGE);
  process.exit(2);
}

const routes = loadSpec(JSON.parse(readFileSync(specPath, 'utf8')));

if (command === 'routes') {
  for (const r of routes) console.log(`${r.method.padEnd(6)} ${r.path}  -> ${r.status}${r.resource ? `  [${r.resource.kind}:${r.resource.name}]` : ''}`);
} else if (command === 'serve') {
  mkdirSync('data', { recursive: true });
  const store = new Store(values.db);
  const server = createServer(new MockEngine(routes, store), store);
  server.listen(Number(values.port), () => console.log(`AutoMock AI on http://localhost:${values.port}  (dashboard: /__automock)`));
} else if (command === 'verify') {
  if (!values.target) {
    console.error('verify needs --target <baseUrl>');
    process.exit(2);
  }
  const results = await verifyTarget(routes, values.target);
  for (const r of results) console.log(`${r.errors.length ? 'FAIL' : 'ok  '} ${r.route} (${r.status ?? 'n/a'})${r.errors.map((e) => `\n       ${e}`).join('')}`);
  process.exit(results.some((r) => r.errors.length) ? 1 : 0);
} else {
  console.error(USAGE);
  process.exit(2);
}
