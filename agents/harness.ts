/**
 * Daily self-improvement loop:  Triage -> (Developer -> QA -> Refactor) x top-N tasks
 * Every phase is committed only if it passes scope checks AND all hard gates. Failures roll back to the last good commit.
 *
 * Env: DRY_RUN=1 (no model calls, no branch/commit)  MAX_TASKS=3  MAX_RETRIES=1  AUTO_MERGE=1  BASE_BRANCH=main
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { checkScope, countTests, gateFailures, run, tail } from './guardrails.ts';
import type { Role } from './guardrails.ts';
import { runAgent } from './runner.ts';
import { collectSignals } from './signals.ts';

const DRY = process.env.DRY_RUN === '1';
const MAX_TASKS = Number(process.env.MAX_TASKS ?? 3);
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 1);
const AUTO_MERGE = process.env.AUTO_MERGE === '1';
const BASE = process.env.BASE_BRANCH ?? 'main';
const DAY = new Date().toISOString().slice(0, 10);

interface Task {
  id: string;
  title: string;
  kind: 'bug' | 'feature' | 'chore';
  rationale: string;
  acceptance: string;
  feedbackId?: string;
}
interface Outcome {
  task: Task;
  ok: boolean;
  note: string;
}

const git = (...args: string[]) => {
  const r = run('git', args);
  if (!r.ok) throw new Error(`git ${args.join(' ')} failed:\n${r.out}`);
  return r.out.trim();
};
const rollback = (sha: string) => {
  git('reset', '--hard', sha);
  git('clean', '-fd');
};
const render = (name: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), readFileSync(`agents/prompts/${name}.md`, 'utf8'));

function commitIfChanged(message: string): void {
  git('add', '-A');
  if (run('git', ['diff', '--cached', '--quiet']).ok) return; // nothing staged
  git('commit', '-m', message);
}

/** TRIAGE: read-only. Must leave the tree untouched. */
function triage(): Task[] {
  const res = runAgent('triage', render('triage', { signals: collectSignals(), max: String(MAX_TASKS) }), DRY);
  if (!DRY && run('git', ['status', '--porcelain']).out.trim()) {
    rollback(git('rev-parse', 'HEAD'));
    throw new Error('Triage modified files; rolled back.');
  }
  const json = res.output.slice(res.output.indexOf('['), res.output.lastIndexOf(']') + 1);
  const tasks = JSON.parse(json) as Task[];
  return tasks
    .filter((t) => typeof t?.id === 'string' && typeof t.title === 'string' && typeof t.acceptance === 'string')
    .slice(0, MAX_TASKS);
}

/** One Developer/QA/Refactor turn with gated retries. Throws if it cannot get green. */
function runPhase(role: Role, task: Task): void {
  const start = git('rev-parse', 'HEAD');
  const testsBefore = countTests();
  let feedback = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = runAgent(role, render(role, { task: JSON.stringify(task, null, 2), feedback }), DRY);
    if (!res.ok) {
      feedback = `Your previous run crashed:\n${tail(res.output)}`;
      rollback(start);
      continue;
    }
    git('add', '-A');

    const scope = checkScope(role, testsBefore);
    if (scope.length && !DRY) {
      feedback = `Policy violations (your changes were discarded, redo them):\n- ${scope.join('\n- ')}`;
      rollback(start);
      continue;
    }

    const failures = gateFailures();
    if (failures.length === 0) {
      commitIfChanged(`agent(${role}): ${task.title}`);
      return;
    }
    if (DRY) throw new Error(`gates red in dry-run:\n${failures.join('\n')}`);
    feedback = `Gates are red. Fix them (your working tree is kept):\n${failures.join('\n\n')}`;
  }
  rollback(start);
  throw new Error(`${role} could not pass gates after ${MAX_RETRIES + 1} attempt(s):\n${feedback}`);
}

function runTask(task: Task): Outcome {
  const checkpoint = git('rev-parse', 'HEAD');
  try {
    for (const role of ['developer', 'qa', 'refactor'] as const) {
      console.log(`  - ${role}`);
      runPhase(role, task);
    }
    if (task.feedbackId && !DRY) {
      appendFileSync('feedback/handled.jsonl', `${JSON.stringify({ id: task.feedbackId, day: DAY })}\n`);
      commitIfChanged(`agent: mark feedback ${task.feedbackId} handled`);
    }
    return { task, ok: true, note: 'merged into daily branch' };
  } catch (e) {
    rollback(checkpoint);
    return { task, ok: false, note: tail((e as Error).message, 1500) };
  }
}

function writeReport(outcomes: Outcome[]): void {
  mkdirSync('reports', { recursive: true });
  const body = outcomes.length
    ? outcomes.map((o) => `## ${o.ok ? 'DONE' : 'FAILED'}: ${o.task.title}\n- kind: ${o.task.kind}\n- why: ${o.task.rationale}\n- acceptance: ${o.task.acceptance}\n- result: ${o.note}\n`).join('\n')
    : 'No tasks selected today.\n';
  writeFileSync(`reports/${DAY}.md`, `# Agent report ${DAY}\n\n${body}`);
}

function main(): void {
  if (run('git', ['status', '--porcelain']).out.trim()) throw new Error('Working tree must be clean before the daily run.');

  const branch = `agent/${DAY}`;
  if (!DRY) git('checkout', '-B', branch, BASE);

  console.log('Triage...');
  const tasks = triage();
  console.log(`Selected ${tasks.length} task(s): ${tasks.map((t) => t.id).join(', ') || '-'}`);

  const outcomes: Outcome[] = [];
  for (const task of tasks) {
    console.log(`Task ${task.id}: ${task.title}`);
    outcomes.push(runTask(task));
  }

  if (DRY) return console.log('DRY_RUN complete (pipeline + gates ran, nothing committed).');

  writeReport(outcomes);
  commitIfChanged(`agent: daily report ${DAY}`);

  const shipped = outcomes.filter((o) => o.ok).length;
  console.log(`${shipped}/${outcomes.length} task(s) shipped on ${branch}`);
  if (shipped && AUTO_MERGE) {
    const failures = gateFailures(); // final full-branch check
    if (failures.length) throw new Error(`Final gate failed, not merging:\n${failures.join('\n')}`);
    git('checkout', BASE);
    git('merge', '--no-ff', branch, '-m', `Merge ${branch}`);
    console.log(`Merged ${branch} into ${BASE}.`);
  }
  process.exitCode = outcomes.some((o) => !o.ok) && !shipped ? 1 : 0;
}

main();
