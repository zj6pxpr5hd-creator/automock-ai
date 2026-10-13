# AutoMock AI — guide for coding agents

## What this is
A self-hosted API mock + contract-testing server. Input: OpenAPI JSON. Output: stateful mock endpoints.

## Map
- `src/engine/schema.ts`    OpenAPI -> `Route[]` ($ref/allOf resolution, REST resource inference). Pure.
- `src/engine/generator.ts` Seeded fake-data generator from a JSON schema. Pure, deterministic.
- `src/engine/contract.ts`  `validate(value, schema)` and `verifyTarget()` (check a real backend vs the spec).
- `src/engine/state.ts`     SQLite `Store` (resources + request_log). Only place that touches the DB.
- `src/engine/mock.ts`      `MockEngine.handle({method,path,body,query,forceStatus})` -> `{status,body,violations}`. No HTTP here.
- `src/server.ts`           HTTP adapter + `/__automock/*` admin API and dashboard.
- `src/cli.ts`              `serve | routes | verify`.
- `test/`                   `node:test` suites (`*.test.ts`). Engine tests call `engine.handle` directly.
- `feedback/inbox.jsonl`    User feedback, one JSON object per line: `{"id","text","source"}`.

## Commands
- `npm run verify`  = typecheck + security lint + all tests. Must be green before you finish.
- `npm test`        tests only.

## Conventions
- TypeScript, Node >= 22.18, ESM, run natively (type stripping): use `import type`, `.ts` extensions in imports,
  no `enum` / `namespace` / parameter properties.
- Zero runtime dependencies. Do not add any.
- Engine functions stay pure and testable; HTTP/SQLite concerns stay in server.ts / state.ts.
- Every behavior change needs a test. Never delete or weaken tests.
- `violations: string[]` in a `MockResponse` is how problems reach Triage — use it for anything a maintainer should see.

## Off limits (enforced by the harness; edits are discarded)
`agents/`, `scripts/`, `.github/`, `package.json`, `package-lock.json`, `tsconfig.json`, this file.
