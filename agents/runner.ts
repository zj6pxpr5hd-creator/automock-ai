/**
 * Runs one agent turn. The agent is any CLI that takes a prompt on stdin and edits files in the cwd.
 * Default: Claude Code headless. Override with AGENT_CMD (e.g. another CLI agent). DRY_RUN=1 never calls a model.
 */
import { spawnSync } from 'node:child_process';

export interface AgentResult {
  ok: boolean;
  output: string;
}

const DEFAULT_CMD = 'claude -p --permission-mode acceptEdits --allowedTools "Edit Write Read Glob Grep Bash(npm test:*) Bash(npm run:*)"';

export function runAgent(role: string, prompt: string, dryRun: boolean): AgentResult {
  if (dryRun) {
    return {
      ok: true,
      output:
        role === 'triage'
          ? JSON.stringify([
              { id: 'dry-1', title: '(dry-run) example task', kind: 'chore', rationale: 'pipeline smoke test', acceptance: 'n/a' },
            ])
          : '(dry-run) no changes made',
    };
  }
  const r = spawnSync(process.env.AGENT_CMD ?? DEFAULT_CMD, {
    shell: true, // command comes from our own env/config, never from agent output
    input: prompt,
    encoding: 'utf8',
    timeout: Number(process.env.AGENT_TIMEOUT_MS ?? 20 * 60_000),
    maxBuffer: 50 * 1024 * 1024,
  });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
