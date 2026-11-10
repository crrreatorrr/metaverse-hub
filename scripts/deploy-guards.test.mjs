// check-env.sh rejects an `export SHOOTER_PVP=1` line, and check-dist-secrets.sh
// still refuses dev credential literals and live keys while allowing the login
// field name "password". check-nakama-drain.sh refuses a restart when a Shooter
// hold or a hard match is open unless --allow-open is passed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function hex() {
  return randomBytes(24).toString('hex');
}

function validEnv(extra = '') {
  const keys = {
    DOMAIN: 'example.test',
    POSTGRES_PASSWORD: hex(),
    NAKAMA_SERVER_KEY: hex(),
    NAKAMA_HTTP_KEY: hex(),
    NAKAMA_SESSION_ENCRYPTION_KEY: hex(),
    NAKAMA_REFRESH_ENCRYPTION_KEY: hex(),
    NAKAMA_CONSOLE_PASSWORD: hex(),
    NAKAMA_CONSOLE_SIGNING_KEY: hex(),
    TICKET_HMAC_KEY: hex(),
    RECOVERY_PEPPER: hex(),
  };
  const body = Object.entries(keys).map(([name, value]) => `${name}=${value}`).join('\n');
  return { keys, text: `${body}\n${extra}` };
}

function deployTree(envText) {
  const tmp = mkdtempSync(join(tmpdir(), 'deploy-guards-'));
  const scripts = join(tmp, 'deploy', 'scripts');
  mkdirSync(scripts, { recursive: true });
  cpSync(join(root, 'deploy/scripts/lib.sh'), join(scripts, 'lib.sh'));
  cpSync(join(root, 'deploy/scripts/check-env.sh'), join(scripts, 'check-env.sh'));
  cpSync(join(root, 'deploy/scripts/check-dist-secrets.sh'), join(scripts, 'check-dist-secrets.sh'));
  cpSync(join(root, 'deploy/scripts/check-nakama-drain.sh'), join(scripts, 'check-nakama-drain.sh'));
  chmodSync(join(scripts, 'check-env.sh'), 0o755);
  chmodSync(join(scripts, 'check-dist-secrets.sh'), 0o755);
  chmodSync(join(scripts, 'check-nakama-drain.sh'), 0o755);
  writeFileSync(join(tmp, 'deploy', '.env'), envText, { mode: 0o600 });
  return { tmp, scripts };
}

function run(script, args, envText, extraEnv = {}) {
  const box = deployTree(envText);
  const res = spawnSync('bash', [join(box.scripts, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  rmSync(box.tmp, { recursive: true, force: true });
  return res;
}

const plain = validEnv();
const ok = run('check-env.sh', [], plain.text);
assert.equal(ok.status, 0, ok.stderr);
assert.match(ok.stdout, /deploy\/\.env ok/);

const exported = run('check-env.sh', [], validEnv('export SHOOTER_PVP=1\n').text);
assert.notEqual(exported.status, 0, exported.stdout);
assert.match(exported.stderr, /SHOOTER_PVP/);

const bare = run('check-env.sh', [], validEnv('SHOOTER_PVP=1\n').text);
assert.notEqual(bare.status, 0);
assert.match(bare.stderr, /SHOOTER_PVP/);

const comment = run('check-env.sh', [], validEnv('# export SHOOTER_PVP=1\n').text);
assert.equal(comment.status, 0, comment.stderr);

function distCase(files, envText) {
  const box = deployTree(envText);
  const dist = join(box.tmp, 'dist');
  mkdirSync(dist, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dist, name), body);
  }
  const res = spawnSync('bash', [join(box.scripts, 'check-dist-secrets.sh'), dist], { encoding: 'utf8' });
  rmSync(box.tmp, { recursive: true, force: true });
  return res;
}

const ui = distCase({
  'index.html': '<input type="password" autocomplete="current-password">Enter a password. changeme is a word.',
  'login.js': 'field:"password"; hint:"Use at least 8 characters."',
}, plain.text);
assert.equal(ui.status, 0, ui.stderr);

const devKey = distCase({ 'app.js': 'serverKey:"defaultkey"' }, plain.text);
assert.notEqual(devKey.status, 0);
assert.match(devKey.stderr, /defaultkey/);

const pem = distCase({ 'oops.txt': '-----BEGIN PRIVATE KEY-----\nabc\n' }, plain.text);
assert.notEqual(pem.status, 0);
assert.match(pem.stderr, /PRIVATE_KEY/);

const leaked = distCase({ 'bundle.js': `key=${plain.keys.NAKAMA_HTTP_KEY}` }, plain.text);
assert.notEqual(leaked.status, 0);
assert.match(leaked.stderr, /NAKAMA_HTTP_KEY/);

function drain(held, hard, args = [], http = 200) {
  const { keys, text } = validEnv();
  const box = deployTree(text);
  const bin = join(box.tmp, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
printf '%s' '${held}'
exit 0
`);
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
out=""
prev=""
for a in "$@"; do
  case "$prev" in -o) out="$a" ;; esac
  prev="$a"
done
cfg="$(cat)"
printf '%s' "$cfg" | grep -q '${keys.NAKAMA_HTTP_KEY}' || { echo missing key >&2; exit 2; }
printf '%s' '{"hard":${hard}}' > "$out"
printf '%s' '${http}'
exit 0
`);
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
  const res = spawnSync('bash', [join(box.scripts, 'check-nakama-drain.sh'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  rmSync(box.tmp, { recursive: true, force: true });
  return res;
}

const clear = drain('0', 0);
assert.equal(clear.status, 0, clear.stderr);
assert.match(clear.stdout, /drain ok/);

const holds = drain('2', 0);
assert.notEqual(holds.status, 0);
assert.match(holds.stderr, /holds=2/);

const live = drain('0', 3);
assert.notEqual(live.status, 0);
assert.match(live.stderr, /hard matches=3/);

const forced = drain('2', 3, ['--allow-open']);
assert.equal(forced.status, 0, forced.stderr);
assert.match(forced.stderr, /override/);

const unread = drain('0', 0, [], 404);
assert.notEqual(unread.status, 0);
assert.match(unread.stderr, /could not read live matches/);

const unreadOverride = drain('0', 0, ['--allow-open'], 404);
assert.equal(unreadOverride.status, 0, unreadOverride.stderr);
assert.match(unreadOverride.stderr, /override/);

console.log('deploy-guards ok');
