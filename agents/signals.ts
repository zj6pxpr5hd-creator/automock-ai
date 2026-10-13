/** Collects everything Triage is allowed to look at. Read-only. */
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { run, tail } from './guardrails.ts';

export interface FeedbackItem {
  id: string;
  text: string;
  source?: string;
}

export function collectSignals(): string {
  const parts: string[] = [];

  const tests = run('npm', ['test', '-s']);
  parts.push(`## Test suite\n${tests.ok ? 'All tests passing.' : `FAILING:\n${tail(tests.out, 4000)}`}`);

  const handled = new Set(readJsonl('feedback/handled.jsonl').map((h) => h.id));
  const feedback = (readJsonl('feedback/inbox.jsonl') as FeedbackItem[]).filter((f) => !handled.has(f.id));
  parts.push(`## User feedback (unhandled)\n${feedback.length ? feedback.map((f) => `- [${f.id}] ${f.text}`).join('\n') : '(none)'}`);

  parts.push(`## Runtime contract violations / unmatched routes (from request log)\n${runtimeViolations()}`);
  return parts.join('\n\n');
}

function runtimeViolations(): string {
  const file = process.env.AUTOMOCK_DB ?? 'data/automock.db';
  if (!existsSync(file)) return '(no request log yet)';
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT method, path, violations, COUNT(*) AS n FROM request_log
       WHERE violations != '[]' GROUP BY method, path, violations ORDER BY n DESC LIMIT 20`,
    )
    .all();
  db.close();
  return rows.length ? rows.map((r) => `- ${r.n}x ${r.method} ${r.path}: ${r.violations}`).join('\n') : '(none)';
}

function readJsonl(file: string): any[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
