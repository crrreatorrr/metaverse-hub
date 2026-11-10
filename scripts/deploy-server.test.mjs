// deploy/scripts/deploy-server.sh against stubbed docker, curl, git, id and sleep (ZK-01).
// The script and lib.sh are copied into a temp deploy/ tree whose sibling scripts
// (check-env, backup-postgres, deploy-game) are stubs too, so nothing here can reach a
// real Docker daemon, database or Nakama. Every stub appends one line to a shared log,
// and the assertions check what ran and in which order.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'stubhttpkey0123456789abcdefghijklmnop';

if (process.platform === 'win32') {
  console.log('deploy-server test skipped (needs bash)');
  process.exit(0);
}

function exe(path, body) {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}`);
  chmodSync(path, 0o755);
}

/** A fresh temp tree: <tmp>/deploy/{.env,compose.yml,scripts/*} plus <tmp>/bin stubs. */
function sandbox() {
  const tmp = mkdtempSync(join(tmpdir(), 'deploy-server-'));
  const scripts = join(tmp, 'deploy', 'scripts');
  const bin = join(tmp, 'bin');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  copyFileSync(join(root, 'deploy/scripts/deploy-server.sh'), join(scripts, 'deploy-server.sh'));
  copyFileSync(join(root, 'deploy/scripts/lib.sh'), join(scripts, 'lib.sh'));
  copyFileSync(join(root, 'deploy/compose.yml'), join(tmp, 'deploy', 'compose.yml'));
  writeFileSync(join(tmp, 'deploy', '.env'), `DOMAIN=example.test\nNAKAMA_HTTP_KEY=${KEY}\n`);
  const log = join(tmp, 'calls.log');
  writeFileSync(log, '');
  const say = (line) => `printf '%s\\n' "${line}" >> "$STUB_LOG"`;

  exe(join(scripts, 'check-env.sh'), `${say('check-env')}\n`);
  exe(join(scripts, 'backup-postgres.sh'), `${say('backup')}\n`);
  exe(join(scripts, 'deploy-game.sh'), `${say('deploy-game $*')}\n`);
  exe(join(scripts, 'check-nakama-drain.sh'), `if [ "\$#" -eq 0 ]; then
  ${say('drain-check')}
else
  ${say('drain-check $*')}
fi
if [ "\${STUB_DRAIN_FAIL:-}" = 1 ]; then
  case " \$* " in
    *" --allow-open "*) exit 0 ;;
  esac
  echo "refusing: shooter holds open" >&2
  exit 1
fi
`);

  exe(join(bin, 'id'), `[ "\${1:-}" = -u ] && { echo 0; exit 0; }\nexec /usr/bin/id "$@"\n`);
  exe(
    join(bin, 'git'),
    `case "$*" in
  *rev-parse*) echo 0123456789ab ;;
  *status*) [ -n "\${STUB_DIRTY:-}" ] && echo ' M server/modules/src/main.ts' ;;
esac
exit 0
`,
  );
  exe(
    join(bin, 'sleep'),
    `${say('sleep $1')}
if [ -n "\${STUB_SLEEP_INT:-}" ]; then kill -INT "$PPID"; fi
exit 0
`,
  );
  // docker: logs IMAGE_TAG with every call; answers the read-only queries the script makes.
  exe(
    join(bin, 'docker'),
    `${say('docker IMAGE_TAG=${IMAGE_TAG:-} $*')}
case "$*" in
  *" ps -q nakama"*) echo cid-live ;;
  "inspect -f {{.Image}} cid-live") echo sha256:live ;;
  "image inspect -f {{join .RepoTags \\" \\"}} sha256:live") echo "\${STUB_LIVE_TAGS:-metaverse-nakama:prod metaverse-nakama:aaaaaaaaaaaa}" ;;
  "image inspect metaverse-nakama:"*)
    [ "$3" = "metaverse-nakama:\${STUB_MISSING_TAG:-}" ] && exit 1 ;;
  *" up "*) [ -n "\${STUB_UP_FAIL:-}" ] && exit 1 ;;
esac
exit 0
`,
  );
  // curl: the http key arrives in a config on stdin (-K -). Logs the RPC name, argv and body.
  exe(
    join(bin, 'curl'),
    `cfg=""
out=""
data=""
url=""
prev=""
for a in "$@"; do
  case "$prev" in
    -o) out="$a" ;;
    --data) data="$a" ;;
  esac
  case "$a" in http://*) url="$a" ;; esac
  prev="$a"
done
case " $* " in *" -K - "*) cfg="$(cat)" ;; esac
if [ -n "$cfg" ]; then url="$(printf '%s' "$cfg" | sed -n 's/^url = "\\(.*\\)"$/\\1/p')"; fi
printf 'curl-argv %s\\n' "$*" >> "$STUB_LOG"
case "$url" in
  */healthcheck)
    ${say('healthcheck')}
    [ -n "\${STUB_HEALTH_FAIL:-}" ] && exit 22
    exit 0 ;;
esac
name="\${url#*/v2/rpc/}"
name="\${name%%\\?*}"
case "$url" in *"http_key=${KEY}"*) ;; *) echo "stub: missing http key" >&2; exit 2 ;; esac
${say('rpc $name $data')}
code=200
body='{}'
if [ "\${STUB_MAINT:-present}" = absent ]; then
  code=404
  body='{"code":5,"message":"RPC function not found"}'
elif [ "$name" = maint.begin ] && [ -n "\${STUB_BEGIN_CODE:-}" ]; then
  code="$STUB_BEGIN_CODE"
  body='{"error":"boom"}'
elif [ "$name" = maint.live ]; then
  n="$(head -n 1 "$STUB_LIVE")"
  rest="$(tail -n +2 "$STUB_LIVE")"
  [ -n "$rest" ] && printf '%s\\n' "$rest" > "$STUB_LIVE"
  body="{\\"hard\\":$n,\\"soft\\":4,\\"kinds\\":{\\"duel\\":0,\\"arena\\":0,\\"coop\\":$n,\\"shooter\\":0}}"
fi
printf '%s' "$body" > "$out"
printf '%s' "$code"
exit 0
`,
  );
  return { tmp, bin, log, script: join(scripts, 'deploy-server.sh') };
}

function run(args = [], env = {}, live = ['2', '1', '0']) {
  const box = sandbox();
  const liveFile = join(box.tmp, 'live.txt');
  writeFileSync(liveFile, `${live.join('\n')}\n`);
  const res = spawnSync('bash', [box.script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${box.bin}:${process.env.PATH}`,
      HOME: box.tmp,
      STUB_LOG: box.log,
      STUB_LIVE: liveFile,
      ...env,
    },
  });
  const calls = readFileSync(box.log, 'utf8').split('\n').filter(Boolean);
  rmSync(box.tmp, { recursive: true, force: true });
  const steps = calls.filter((l) => !l.startsWith('curl-argv'));
  return { code: res.status, out: `${res.stdout}${res.stderr}`, calls, steps };
}

const idx = (steps, re) => steps.findIndex((l) => re.test(l));
const count = (steps, re) => steps.filter((l) => re.test(l)).length;

function inOrder(steps, ...res) {
  let last = -1;
  for (const re of res) {
    const i = steps.findIndex((l, n) => n > last && re.test(l));
    assert.ok(i > last, `expected ${re} after step ${last}\n${steps.join('\n')}`);
    last = i;
  }
}

function keyNeverInArgv(calls) {
  for (const l of calls) assert.ok(!l.includes(KEY), `http key leaked into a command line: ${l}`);
}

// 1. Full drain: backup, build while the old node runs, begin, poll to 0, notice, switch, health, end.
{
  const r = run([], {}, ['2', '1', '0']);
  assert.equal(r.code, 0, r.out);
  inOrder(
    r.steps,
    /^check-env$/,
    /^backup$/,
    /^docker IMAGE_TAG=0123456789ab compose .* build nakama$/,
    /^rpc maint\.begin \{"reason":"deploy 0123456789ab","deadline":\d+\}$/,
    /^rpc maint\.live/,
    /^sleep 15$/,
    /^rpc maint\.live/,
    /^sleep 15$/,
    /^rpc maint\.live/,
    /^sleep 60$/,
    /^drain-check$/,
    /^docker IMAGE_TAG=\S* tag metaverse-nakama:0123456789ab metaverse-nakama:prod$/,
    /^docker IMAGE_TAG=prod compose .* up -d --no-build --no-deps --force-recreate --wait --wait-timeout 240 nakama$/,
    /^healthcheck$/,
    /^rpc maint\.end \{\}$/,
  );
  assert.equal(count(r.steps, /^rpc maint\.live/), 3, 'polls until hard matches reach 0');
  assert.equal(count(r.steps, /^rpc maint\.end/), 1, 'maint.end once, not again from the EXIT trap');
  assert.equal(count(r.steps, /^deploy-game/), 0, 'game pages only on request');
  assert.match(r.out, /hard 2 \(duel 0, arena 0, coop 2, shooter 0\)/);
  assert.match(r.out, /IMAGE_TAG=aaaaaaaaaaaa .*deploy-server\.sh --no-drain/, 'prints the rollback command');
  keyNeverInArgv(r.calls);
}

// 2. Server without the maint RPCs yet: warn, fixed wait, still deploy, never call maint.live/end.
{
  const r = run([], { STUB_MAINT: 'absent', NO_MAINT_WAIT_SEC: '45' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARNING: .*maint\.begin/);
  inOrder(r.steps, /^rpc maint\.begin/, /^sleep 45$/, / up -d --no-build/, /^healthcheck$/);
  assert.equal(count(r.steps, /^rpc maint\.(live|end)/), 0);
}

// 3. Rollback: IMAGE_TAG=<prev> --no-drain skips build and maintenance, retags and restarts.
{
  const r = run(['--no-drain'], { IMAGE_TAG: 'aaaaaaaaaaaa' });
  assert.equal(r.code, 0, r.out);
  assert.equal(count(r.steps, / build /), 0, 'a given IMAGE_TAG is not rebuilt');
  assert.equal(count(r.steps, /^rpc /), 0, '--no-drain calls no maint RPC');
  assert.equal(count(r.steps, /^sleep /), 0);
  inOrder(
    r.steps,
    /^docker IMAGE_TAG=\S* image inspect metaverse-nakama:aaaaaaaaaaaa$/,
    /^backup$/,
    /^drain-check$/,
    /^docker IMAGE_TAG=\S* tag metaverse-nakama:aaaaaaaaaaaa metaverse-nakama:prod$/,
    /^docker IMAGE_TAG=prod compose .* up -d --no-build/,
    /^healthcheck$/,
  );
}

// 4. Rollback to a tag that does not exist fails before backup or any restart.
{
  const r = run(['--no-drain'], { IMAGE_TAG: 'nope', STUB_MISSING_TAG: 'nope' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no image metaverse-nakama:nope/);
  assert.equal(idx(r.steps, /^backup$/), -1);
  assert.equal(idx(r.steps, / up /), -1);
}

// 5. Restart fails: exit non-zero, but the EXIT trap still ends maintenance.
{
  const r = run([], { STUB_UP_FAIL: '1' }, ['0']);
  assert.notEqual(r.code, 0);
  inOrder(r.steps, /^rpc maint\.begin/, / up -d --no-build/, /^rpc maint\.end \{\}$/);
  assert.equal(count(r.steps, /^rpc maint\.end/), 1);
  assert.match(r.out, /rollback/i);
}

// 6. Ctrl-C while draining: maintenance ends, nothing restarts.
{
  const r = run([], { STUB_SLEEP_INT: '1' }, ['3']);
  assert.equal(r.code, 130, r.out);
  inOrder(r.steps, /^rpc maint\.begin/, /^rpc maint\.live/, /^sleep 15$/, /^rpc maint\.end \{\}$/);
  assert.equal(idx(r.steps, / up /), -1);
  assert.equal(idx(r.steps, / tag /), -1);
}

// 7. maint.begin errors (not 404): stop before any restart; maintenance was never on.
{
  const r = run([], { STUB_BEGIN_CODE: '500' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /maint\.begin failed .*500/);
  assert.equal(idx(r.steps, / up /), -1);
  assert.equal(count(r.steps, /^rpc maint\.end/), 0);
}

// 8. Deadline passes with hard matches still live: deploy anyway after the notice wait.
{
  const r = run([], { DRAIN_MINUTES: '0' }, ['5']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /deadline/i);
  inOrder(r.steps, /^rpc maint\.live/, /^sleep 60$/, / up -d --no-build/, /^rpc maint\.end/);
}

// 9. Game pages go last, only when asked, after maintenance ends.
{
  const box = mkdtempSync(join(tmpdir(), 'deploy-server-game-'));
  writeFileSync(join(box, 'index.html'), '<!doctype html>');
  const r = run(['--game', `sproto-duel=${box}`], {}, ['0']);
  rmSync(box, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
  inOrder(r.steps, /^rpc maint\.end/, new RegExp(`^deploy-game sproto-duel ${box}$`));
}

// 10. A game dir without index.html is refused up front, before any backup or build.
{
  const r = run(['--game', 'nobu=/nonexistent-dir']);
  assert.equal(r.code, 2, r.out);
  assert.equal(idx(r.steps, /^backup$/), -1);
}

// 11. A dirty checkout is refused unless ALLOW_DIRTY=1 (the sha tag would not name the code).
{
  const r = run([], { STUB_DIRTY: '1' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /uncommitted/);
  assert.equal(idx(r.steps, /^backup$/), -1);
}

// 12. DRY_RUN=1 changes nothing: no backup, build, tag, restart, game deploy or maint.begin/end.
{
  const box = mkdtempSync(join(tmpdir(), 'deploy-server-game-'));
  writeFileSync(join(box, 'index.html'), '<!doctype html>');
  const r = run(['--game', `nobu=${box}`], { DRY_RUN: '1' }, ['2']);
  rmSync(box, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
  for (const re of [/^backup$/, / build /, / tag /, / up /, /^deploy-game/, /^rpc maint\.(begin|end)/, /^sleep /]) {
    assert.equal(idx(r.steps, re), -1, `DRY_RUN ran ${re}\n${r.steps.join('\n')}`);
  }
  assert.equal(count(r.steps, /^rpc maint\.live/), 1, 'DRY_RUN reads the live count once');
  assert.match(r.out, /DRY_RUN: .*backup-postgres\.sh/);
  assert.match(r.out, /DRY_RUN: .*up -d --no-build/);
  keyNeverInArgv(r.calls);
}

// 13. compose.yml keeps today's tag by default and accepts IMAGE_TAG.
{
  const compose = readFileSync(join(root, 'deploy/compose.yml'), 'utf8');
  assert.match(compose, /^ {4}image: metaverse-nakama:\$\{IMAGE_TAG:-prod\}$/m);
}

// 14. Open holds or matches stop the restart before the container is recreated.
{
  const r = run([], { STUB_DRAIN_FAIL: '1' });
  assert.notEqual(r.code, 0, r.out);
  assert.equal(idx(r.steps, / up -d --no-build/), -1, 'did not restart');
  assert.ok(idx(r.steps, /^drain-check$/) >= 0);
}

// 15. --allow-open is the explicit override and still reaches the restart.
{
  const r = run(['--allow-open'], { STUB_DRAIN_FAIL: '1' });
  assert.equal(r.code, 0, r.out);
  assert.ok(idx(r.steps, /^drain-check --allow-open$/) >= 0);
  assert.ok(idx(r.steps, / up -d --no-build/) > idx(r.steps, /^drain-check --allow-open$/));
}

console.log('deploy-server ok (15 cases against stubbed docker/curl)');
