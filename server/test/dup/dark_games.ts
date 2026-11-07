/**
 * Live Nakama checks for the dark sproto-shooter and sproto-coop-battle registrations.
 * A portal ticket redeems once. The same ids cannot mint Tickets, Relics, or scores.
 */
import assert from 'node:assert/strict';
import {
  call,
  guest,
  num,
  psql,
  redeemPortalTicket,
  sqlId,
  ticketBalance,
} from './harness.ts';

const DARK = ['sproto-shooter', 'sproto-coop-battle'] as const;
const FOREIGN = '99999999-9999-4999-8999-999999999999';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

function gameId(game: string): string {
  if (!DARK.includes(game as (typeof DARK)[number]) && game !== 'sproto') throw new Error(`refusing game ${game}`);
  return game;
}

function ledger(userId: string, game: string): number {
  return num(
    `SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = '${gameId(game)}'`,
  );
}

function relicCount(userId: string): number {
  return num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${sqlId(userId)}'`);
}

function scoreCount(userId: string): number {
  return num(`SELECT count(*) FROM game.ranked_score WHERE user_id = '${sqlId(userId)}'`);
}

function rejected(status: number, token: string | undefined): boolean {
  return !token || status >= 400;
}

export async function runDarkGames(test: TestFn): Promise<void> {
  await test('dark-games', 'session and ticket checks keep vcoin and both new ids', async () => {
    const session = psql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'game_session_game'`);
    const ticket = psql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'auth_ticket_game'`);
    for (const id of ['hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', ...DARK]) {
      assert.match(session, new RegExp(`'${id}'`), `game_session missing ${id}`);
      assert.match(ticket, new RegExp(`'${id}'`), `auth_ticket missing ${id}`);
    }
    assert.equal(num(`SELECT count(*) FROM game.schema_migrations WHERE id = '0039_dark_game_ids'`), 1);
    assert.equal(num(`SELECT count(*) FROM game.schema_migrations WHERE split_part(id, '_', 1) IN ('0036', '0038')`), 0);
    assert.equal(num(`SELECT count(*) FROM game.event_rule WHERE game_id IN ('sproto-shooter', 'sproto-coop-battle')`), 0);
  });

  for (const game of DARK) {
    await test('dark-games', `${game} redeems once and mints nothing`, async () => {
      const owner = await guest();
      const bystander = await guest();
      const opened = await call('portal.enter', { game, ranked: false }, owner.token);
      assert.equal(opened.body.error, undefined, JSON.stringify(opened.body));
      const ticket = String(opened.body.ticket ?? '');
      assert.ok(ticket);
      const first = await redeemPortalTicket(ticket, game);
      assert.ok(first.token, `redeem ${first.status} ${first.body.slice(0, 180)}`);
      const replay = await redeemPortalTicket(ticket, game);
      assert.equal(rejected(replay.status, replay.token), true, `replay ${replay.status}`);
      const earned = await call('tickets.earn', { amount: 20, reason: 'boss_clear', key: `${game}-earn` }, first.token);
      assert.equal(earned.body.error, 'unknown_reason', JSON.stringify(earned.body));
      const event = await call(
        'session.event',
        { eventId: 'sproto.boss_defeated', data: { boss: 'tinubu' }, key: `${game}-event` },
        first.token,
      );
      assert.equal(event.body.granted, undefined, JSON.stringify(event.body));
      const serverBoard = await call('score.submit', { boardId: 'sproto_wins', value: 1, meta: {} }, first.token);
      assert.equal(serverBoard.body.accepted, false, JSON.stringify(serverBoard.body));
      assert.equal(serverBoard.body.reason, 'server_board');
      const score = await call(
        'score.submit',
        { boardId: 'nobu_trial_time', value: 20000, meta: { level: '1' } },
        first.token,
      );
      assert.equal(score.body.error, 'bad_board', JSON.stringify(score.body));
      assert.notEqual(score.body.accepted, true);
      assert.equal(ticketBalance(owner.userId, game), 0);
      assert.equal(ledger(owner.userId, game), 0);
      assert.equal(relicCount(owner.userId), 0);
      assert.equal(scoreCount(owner.userId), 0);
      assert.equal(ticketBalance(bystander.userId, game), 0);
      assert.equal(ledger(bystander.userId, game), 0);
    });

    await test('dark-games', `${game} rejects the wrong game, an expired ticket, and another account`, async () => {
      const owner = await guest();
      const wrongGame = game === 'sproto-shooter' ? 'sproto-coop-battle' : 'sproto-shooter';
      const crossed = await call('portal.enter', { game, ranked: false }, owner.token);
      const crossedTicket = String(crossed.body.ticket ?? '');
      const crossedSession = String(crossed.body.sessionId ?? '');
      const wrong = await redeemPortalTicket(crossedTicket, wrongGame);
      assert.equal(rejected(wrong.status, wrong.token), true, `wrong game ${wrong.status}`);
      const afterWrong = await redeemPortalTicket(crossedTicket, game);
      assert.equal(rejected(afterWrong.status, afterWrong.token), true, 'burned ticket redeemed');
      assert.equal(
        num(`SELECT count(*) FROM game.game_session WHERE session_id = '${sqlId(crossedSession)}' AND ticket_redeemed_at IS NOT NULL`),
        0,
      );

      const expiredOpen = await call('portal.enter', { game, ranked: false }, owner.token);
      const expiredSession = String(expiredOpen.body.sessionId ?? '');
      psql(
        `UPDATE game.auth_ticket SET expires_at = now() - interval '1 second' WHERE session_id = '${sqlId(expiredSession)}'`,
      );
      const expired = await redeemPortalTicket(String(expiredOpen.body.ticket ?? ''), game);
      assert.equal(rejected(expired.status, expired.token), true, `expired ${expired.status}`);
      assert.equal(
        num(`SELECT count(*) FROM game.game_session WHERE session_id = '${sqlId(expiredSession)}' AND ticket_redeemed_at IS NOT NULL`),
        0,
      );

      const foreignOpen = await call('portal.enter', { game, ranked: false }, owner.token);
      const foreignSession = String(foreignOpen.body.sessionId ?? '');
      psql(
        `UPDATE game.auth_ticket SET user_id = '${sqlId(FOREIGN)}' WHERE session_id = '${sqlId(foreignSession)}'`,
      );
      const foreign = await redeemPortalTicket(String(foreignOpen.body.ticket ?? ''), game);
      assert.equal(rejected(foreign.status, foreign.token), true, `foreign account ${foreign.status} ${foreign.body.slice(0, 160)}`);
      assert.equal(ticketBalance(owner.userId, game), 0);
      assert.equal(ledger(owner.userId, game), 0);
      assert.equal(relicCount(owner.userId), 0);
      assert.equal(num(`SELECT count(*) FROM users WHERE id = '${sqlId(FOREIGN)}'`), 0);
    });
  }
}
