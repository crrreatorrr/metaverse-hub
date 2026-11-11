// In-game feedback (server/modules/src/games/hub_feedback.ts): who may submit, what is stored,
// the admin login, and the rule that "resolved" needs a verification note and drops the image.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const G = '22222222-2222-4222-8222-222222222222';
const mod = loadModule();
mod.nk.accounts.set(A, { user: { userId: A, username: 'alice' }, email: 'alice@example.test' });
mod.nk.accounts.set(G, { user: { userId: G, username: 'guest_1' } });

const HUB = { userId: A, vars: { scope: 'hub' } };
const GAME = { userId: A, vars: { scope: 'game', game: 'sproto-shooter', sid: '33333333-3333-4333-8333-333333333333' } };
const IMAGE = 'data:image/jpeg;base64,' + 'A'.repeat(400);
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

mod.nk.onSql(/INSERT INTO game\.feedback_seq/, (args) => [{ public_id: `${String(args[1])}-0001` }]);
mod.nk.onSql(/FROM game\.feedback_admin/, (args) => (args[0] === '333' ? [{ pass_sha256: sha('hub-feedback-admin:333') }] : []));

const inserts = () => mod.nk.sqlCalls.filter((c) => c.sql.includes('INSERT INTO game.feedback_seq'));

// Migration 0059 follows 0058 and seeds the admin row.
{
  const all = (mod.global.HubSchema as { all(): { id: string; statements: string[] }[] }).all();
  const ids = all.map((m) => m.id);
  assert.ok(ids.indexOf('0059_feedback') > ids.indexOf('0058_shooter_verification_observations'));
  const sql = all.find((m) => m.id === '0059_feedback')!.statements.join('\n');
  assert.match(sql, /game\.feedback_image/);
  assert.match(sql, /hub-feedback-admin:333/);
}

// Guests and sessions without a user are refused; nothing is written.
{
  assert.equal(mod.call('feedback.can', { userId: G, vars: { scope: 'hub' } }).error, 'sign_in_required');
  assert.equal(mod.call('feedback.submit', { userId: G, vars: { scope: 'hub' } }, { categories: ['broke'] }).error, 'sign_in_required');
  assert.equal(mod.call('feedback.submit', {}, { categories: ['broke'] }).error, 'unauthorized');
  assert.equal(mod.call('feedback.submit', HUB, {}).error, 'empty');
  assert.equal(mod.call('feedback.submit', HUB, { categories: ['nope'] }).error, 'empty');
  assert.equal(mod.call('feedback.submit', HUB, { note: 'x', image: 'data:text/html;base64,AAAA' }).error, 'bad_image');
  assert.equal(inserts().length, 0);
}

// A signed-in player: the game comes from the session, the username from the account.
{
  assert.deepEqual(mod.call('feedback.can', GAME), { ok: true, game: 'sproto-shooter', username: 'alice' });
  const r = mod.call('feedback.submit', GAME, {
    categories: ['too_hard', 'too_hard', 'bogus'],
    note: '  boss two is brutal  ',
    image: IMAGE,
    clientTime: '2026-11-11T10:00:00.000Z',
    meta: { level: 'L3', mode: 'campaign', position: { x: 1.5, y: 2, z: -3 }, gameTime: 81.2, version: '1.0.0+abc', game: 'hub' },
  });
  assert.deepEqual(r, { ok: true, id: 'SHOOTER-0001' });
  const call = inserts()[0];
  assert.equal(call.args[0], 'sproto-shooter');
  assert.equal(call.args[2], A);
  assert.equal(call.args[3], 'alice');
  assert.equal(call.args[5], '["too_hard"]');
  assert.equal(call.args[6], 'boss two is brutal');
  assert.equal(call.args[8], 'L3');
  assert.deepEqual([...call.args.slice(10, 13)], [1.5, 2, -3]);
  assert.equal(call.args[16], IMAGE);
  assert.equal(mod.call('feedback.submit', HUB, { categories: ['other'] }).id, 'HUB-0001');
}

// Six notes per ten minutes.
{
  let last: Record<string, unknown> = {};
  for (let i = 0; i < 6; i++) last = mod.call('feedback.submit', HUB, { note: `n${i}` });
  assert.equal(last.error, 'rate_limited');
}

// Admin: 333 / 333 logs in, anything else does not, and admin calls need the token.
let token = '';
{
  assert.equal(mod.call('feedback.admin.login', HUB, { user: '333', pass: '334' }).error, 'bad_login');
  assert.equal(mod.call('feedback.admin.login', HUB, { user: 'root', pass: '333' }).error, 'bad_login');
  const ok = mod.call('feedback.admin.login', { userId: G, vars: { scope: 'hub' } }, { user: '333', pass: '333' });
  assert.equal(ok.ok, true);
  token = String(ok.token);
  assert.equal(mod.call('feedback.admin.list', HUB, {}).error, 'unauthorized');
  assert.equal(mod.call('feedback.admin.list', HUB, { token: token + 'x' }).error, 'unauthorized');
  assert.equal(mod.call('feedback.admin.list', HUB, { token: '333:1.' + 'a'.repeat(64) }).error, 'unauthorized');
  const list = mod.call('feedback.admin.list', HUB, { token, game: 'sproto-shooter', status: 'open', category: 'broke', q: '50%' });
  assert.equal(list.ok, true);
  const q = mod.nk.sqlCalls.filter((c) => c.sql.includes('FROM game.feedback WHERE')).pop()!;
  assert.deepEqual([...q.args], ['sproto-shooter', 'open', '["broke"]', '%50\\%%']);
  assert.equal(mod.call('feedback.admin.list', HUB, { token, game: 'nope' }).error, 'bad_game');
}

// Resolving needs a resolution and a verification note, and deletes the screenshot.
{
  mod.nk.onSql(/SELECT id, status, resolution, verification, fixed_commit FROM game\.feedback/, () => [
    { id: 7, status: 'fixed', resolution: '', verification: '', fixed_commit: '' },
  ]);
  const base = { token, id: 'shooter-0001' };
  assert.equal(mod.call('feedback.admin.update', HUB, { ...base, status: 'resolved' }).error, 'resolution_required');
  assert.equal(mod.call('feedback.admin.update', HUB, { ...base, status: 'resolved', resolution: 'Lowered boss HP' }).error, 'verification_required');
  assert.equal(mod.call('feedback.admin.update', HUB, { ...base, status: 'done' }).error, 'bad_status');
  assert.equal(mod.nk.sqlCalls.filter((c) => c.sql.includes('UPDATE game.feedback')).length, 0);
  const r = mod.call('feedback.admin.update', HUB, { ...base, status: 'resolved', resolution: 'Lowered boss HP', verification: 'Replayed L3 on build abc', fixedCommit: 'abc1234' });
  assert.equal(r.ok, true);
  const u = mod.nk.sqlCalls.filter((c) => c.sql.includes('UPDATE game.feedback')).pop()!;
  assert.match(u.sql, /DELETE FROM game\.feedback_image WHERE \$2 = 'resolved'/);
  assert.deepEqual([...u.args], [7, 'resolved', 'Lowered boss HP', 'Replayed L3 on build abc', 'abc1234', '333', 'Lowered boss HP']);
  assert.equal(mod.call('feedback.admin.update', HUB, { ...base, status: 'in_progress' }).ok, true);
}

console.log('feedback ok');
