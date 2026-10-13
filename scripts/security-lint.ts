/** Dependency-free static security lint for src/. Exit 1 on any finding. Agents may NOT edit this file. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RULES: [string, RegExp][] = [
  ['eval()', /\beval\s*\(/],
  ['new Function()', /\bnew\s+Function\s*\(/],
  ['child_process in runtime code', /child_process/],
  ['shell exec', /(?<![.\w])exec(Sync)?\s*\(/],
  ['hard-coded secret', /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{16,}['"]/i],
  ['private key material', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['dynamic SQL via template string', /\.(prepare|exec)\(\s*`[^`]*\$\{/],
  ['outbound call to non-local host', /fetch\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)/],
];

const files = readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
let findings = 0;
for (const file of files) {
  readFileSync(join('src', file), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [name, re] of RULES) {
        if (re.test(line)) {
          console.error(`src/${file}:${i + 1}  ${name}\n    ${line.trim()}`);
          findings++;
        }
      }
    });
}
console.log(findings ? `security-lint: ${findings} finding(s)` : `security-lint: clean (${files.length} files)`);
process.exit(findings ? 1 : 0);
