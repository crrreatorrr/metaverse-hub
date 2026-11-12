import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const tsx = join(dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');
const moduleURL = new URL('../dup/suite.ts', import.meta.url).href;
function canary(rows: unknown[]) {
  // Invoke the actual exported reporter in a separate process: import does not
  // run main()/connect to Nakama, and placeholders cannot authorize a server.
  return spawnSync(process.execPath, [tsx, '-e', `void import(${JSON.stringify(moduleURL)}).then(m=>{process.exitCode=m.report(${JSON.stringify(rows)});});`], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DUP_ONLY: 'reporter-canary', NAKAMA_HTTP_KEY: 'reporter-unit-placeholder-not-a-server-key', NAKAMA_SERVER_KEY: 'reporter-unit-placeholder-not-a-server-key' },
  });
}
const unexpected = canary([
  { category: 'reporter-canary', name: 'control pass', status: 'pass' },
  { category: 'future-category-never-registered', name: 'deliberate failure', status: 'fail', detail: 'intentional reporter canary' },
]);
assert.ifError(unexpected.error);
assert.equal(unexpected.status, 1, unexpected.stderr);
assert.ok(unexpected.stdout.includes('future-category-never-registered: 0 pass, 1 fail'), unexpected.stdout);
const empty = canary([]);
assert.ifError(empty.error);
assert.equal(empty.status, 1, empty.stderr);
assert.ok(empty.stdout.includes('selected filter produced no pass'), empty.stdout);
const allowed = canary([
  { category: 'reporter-canary', name: 'control pass', status: 'pass' },
  { category: 'reporter-canary', name: 'known pending', status: 'pending' },
  { category: 'reporter-canary', name: 'known regression', status: 'expected-fail' },
]);
assert.ifError(allowed.error);
assert.equal(allowed.status, 0, allowed.stderr);
assert.ok(allowed.stdout.includes('1 pass, 0 fail, 1 pending, 1 expected-fail'), allowed.stdout);
console.log('actual duplication reporter process canaries fail closed for unknown failures and empty selection');
