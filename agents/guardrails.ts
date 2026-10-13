/**
 * The safety rails. Agents can write code, but nothing lands unless these pass.
 * Agents may NOT edit this directory (see PROTECTED).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

export type Role = 'developer' | 'qa' | 'refactor';

export const PROTECTED = [/^agents\//, /^scripts\//, /^\.github\//, /^AGENTS\.md$/, /^package(-lock)?\.json$/, /^tsconfig\.json$/];
export const MAX_DIFF_LINES = Number(process.env.MAX_DIFF_LINES ?? 400);

export function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export const tail = (s: string, n = 3000) => (s.length > n ? `...${s.slice(-n)}` : s);

/** Count test cases so "make the tests pass by deleting them" is detectable. */
export function countTests(dir = 'test'): number {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.test.ts'))
    .reduce((n, f) => n + (readFileSync(`${dir}/${f}`, 'utf8').match(/^\s*(test|it)\s*\(/gm)?.length ?? 0), 0);
}

/** Scope/policy checks on the STAGED diff. Returns human-readable violations. */
export function checkScope(role: Role, testsBefore: number): string[] {
  const problems: string[] = [];
  const names = run('git', ['diff', '--cached', '--name-only']).out.split('\n').filter(Boolean);

  const touchedProtected = names.filter((f) => PROTECTED.some((re) => re.test(f)));
  if (touchedProtected.length) problems.push(`Protected paths modified (not allowed): ${touchedProtected.join(', ')}`);

  const lines = run('git', ['diff', '--cached', '--numstat']).out
    .split('\n')
    .filter(Boolean)
    .reduce((n, l) => n + (Number(l.split('\t')[0]) || 0) + (Number(l.split('\t')[1]) || 0), 0);
  if (lines > MAX_DIFF_LINES) problems.push(`Diff too large: ${lines} changed lines (max ${MAX_DIFF_LINES}). Do less.`);

  const deletedTests = run('git', ['diff', '--cached', '--name-only', '--diff-filter=D', '--', 'test']).out.trim();
  if (deletedTests) problems.push(`Test files deleted (not allowed): ${deletedTests}`);

  const testsAfter = countTests();
  if (testsAfter < testsBefore) problems.push(`Test count dropped from ${testsBefore} to ${testsAfter}.`);
  if (role === 'qa' && testsAfter <= testsBefore) problems.push('QA phase must add at least one new test.');
  if (role === 'refactor' && names.some((f) => f.startsWith('test/'))) problems.push('Refactor must not modify tests.');

  return problems;
}

/** Hard gates: types, security lint, full test suite. Everything must be green. */
export function gateFailures(): string[] {
  const gates: [string, string[]][] = [
    ['typecheck', ['run', '-s', 'typecheck']],
    ['security-lint', ['run', '-s', 'lint:security']],
    ['tests', ['test', '-s']],
  ];
  const failures: string[] = [];
  for (const [name, args] of gates) {
    const r = run('npm', args);
    if (!r.ok) failures.push(`Gate "${name}" FAILED:\n${tail(r.out)}`);
  }
  return failures;
}
