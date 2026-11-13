/**
 * Coop boss receipts. One eligible account pays 20 Tickets and one score per
 * canonical boss per UTC day. Retries, races, new rooms, new sessions, both
 * phases, six local seats, and a restart do not duplicate it. Forged client
 * calls, God Mode, AFK, late joins, and CPU takeover pay 0.
 */
import assert from 'node:assert/strict';
import {
  arm,
  call,
  canonical,
  compose,
  disarm,
  dropFaultHooks,
  installFaultHooks,
  num,
  openGame,
  psql,
  psqlAsync,
  sleep,
  sqlId,
  ticketBalance,
  waitReady,
  type GameLogin,
} from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

const PAY = 20;
const REASON = 'srv_coop_boss_clear';
const BOSSES = [
  '01-marina-bront',
  '02-last-light-vela',
  '03-mudline-crapto',
  '04-ranch-zephyr',
  '05-neon-sproto102',
  '06-circuit-rune',
  '07-moonkeep-bigswole',
  '08-crown-alpha777',
  '09-hatchery-highsproto',
  '10-verse-sprotosales',
  '11-rooftop-sproto1668',
  '12-codebreak-sproto3106',
];
const HASH = 'ab'.repeat(32);
// The label game.settle_coop_clear accepts since 0063_coop_settle_fingerprint (the vendored sim's contentSha256).
const FP = 'fb9f2679528b6810dfd3a42ce41bb6f2ed3ac8e75eb3741e2ad30ccd9a4b9a72';
const FP_0041 = 'f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e';

interface Receipt {
  ok?: boolean;
  paid?: boolean;
  sealed?: boolean;
  tickets?: number;
  ticketsMinted?: number;
  reason?: string;
  error?: string;
  day?: string;
  canonicalBoss?: string;
  canonicalCount?: number;
  slots?: number;
  phasesAreOneClear?: number;
  score?: number;
  balance?: number;
  replay?: boolean;
}

function quote(value: string): string {
  if (!/^[A-Za-z0-9:._-]+$/.test(value)) throw new Error(`refusing to interpolate "${value}"`);
  return value;
}

function credits(userId: string, boss = ''): number {
  const bossSql = boss ? ` AND reason = '${REASON}'` : ` AND reason = '${REASON}'`;
  return num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = 'sproto-coop-battle'${bossSql} AND delta = ${PAY}`);
}

function creditSum(userId: string): number {
  return num(`SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = 'sproto-coop-battle' AND reason = '${REASON}'`);
}

function scores(userId: string, boss = ''): number {
  const variant = boss ? ` AND variant = '${quote(boss)}'` : '';
  return num(`SELECT count(*) FROM game.ranked_score WHERE user_id = '${sqlId(userId)}' AND board_id = 'coop_stage_clear_ms_v1'${variant}`);
}

function receipts(userId: string, boss = ''): number {
  const variant = boss ? ` AND canonical_boss = '${quote(boss)}'` : '';
  return num(`SELECT count(*) FROM game.coop_receipt WHERE user_id = '${sqlId(userId)}'${variant}`);
}

function settle(session: GameLogin, boss: string, matchId: string, encounterId: string, opts: {
  day?: string;
  eligible?: number;
  reason?: string;
  slots?: number;
  assistance?: string;
  clearMs?: number;
  tick?: number;
  sessionId?: string;
  protocol?: number;
  fingerprint?: string;
} = {}): Receipt {
  const day = opts.day ?? `(SELECT (now() AT TIME ZONE 'utc')::date)`;
  const daySql = opts.day ? `'${quote(opts.day)}'::date` : day;
  const sql = `SELECT game.settle_coop_clear(
    '${sqlId(session.hub.userId)}'::uuid,
    '${sqlId(opts.sessionId ?? session.sessionId)}'::uuid,
    '${quote(matchId)}'::text,
    '${quote(encounterId)}'::text,
    '${quote(boss)}'::text,
    ${daySql},
    ${opts.tick ?? 1200}::bigint,
    ${opts.clearMs ?? 20000}::bigint,
    ${opts.eligible ?? 1}::smallint,
    '${quote(opts.reason ?? 'clear')}'::text,
    ${opts.slots ?? 1},
    ${opts.protocol ?? 1},
    '${quote(opts.fingerprint ?? FP)}'::text,
    '${quote(opts.assistance ?? 'cpu_assisted')}'::text,
    '${HASH}'::text
  )::text`;
  return JSON.parse(psql(sql)) as Receipt;
}

function settleSql(session: GameLogin, boss: string, matchId: string, encounterId: string, slots = 1): string {
  return `SELECT game.settle_coop_clear(
    '${sqlId(session.hub.userId)}'::uuid,
    '${sqlId(session.sessionId)}'::uuid,
    '${quote(matchId)}'::text,
    '${quote(encounterId)}'::text,
    '${quote(boss)}'::text,
    (SELECT (now() AT TIME ZONE 'utc')::date),
    1200::bigint,
    20000::bigint,
    1::smallint,
    'clear'::text,
    ${slots},
    1,
    '${FP}'::text,
    '${slots === 4 ? 'all_human' : 'cpu_assisted'}'::text,
    '${HASH}'::text
  )::text`;
}

async function waitRestart(): Promise<void> {
  // compose restart returns after the new process is spawned. Give that process
  // time to replace the socket, then wait until both the HTTP healthcheck and
  // the gRPC session port answer.
  await sleep(1500);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const health = await call('healthcheck', {}, undefined, { timeoutMs: 2_000 });
      if (health.status < 400 && !health.body.error) {
        await waitReady();
        return;
      }
    } catch {
      /* the process is still coming back */
    }
    await sleep(500);
  }
  throw new Error('nakama did not accept sessions after restart');
}

export async function runCoopRewards(test: TestFn): Promise<void> {
  const { guest } = await import('./harness.ts');

  async function openCoop(): Promise<GameLogin> {
    const who = await guest();
    return openGame(who.token, 'sproto-coop-battle');
  }

  await test('coop', 'no client event, earn, or score can name the coop payout', async () => {
    assert.equal(num(`SELECT count(*) FROM game.event_rule WHERE game_id = 'sproto-coop-battle' AND tickets > 0`), 0);
    assert.equal(num(`SELECT count(*) FROM game.event_rule WHERE game_id = 'sproto' AND event_type = 'sproto.boss_defeated' AND tickets = 20`), 5);
    assert.equal(num(`SELECT count(*) FROM game.event_rule WHERE game_id = 'sproto-fighter' AND event_type = 'fighter.boss_defeated' AND tickets = 20`), 10);
    assert.equal(num(`SELECT game.session_ticket_cap()`), 200);
    const session = await openCoop();
    const earn = await call('tickets.earn', { amount: 20, reason: REASON, key: 'client-earn' }, session.gameToken);
    assert.equal(earn.body.error, 'server_reason');
    const named = await call('tickets.earn', { amount: 20, reason: 'coop.boss_clear', key: 'client-name' }, session.gameToken);
    assert.equal(named.body.error, 'server_reason');
    const event = await call('session.event', { eventId: 'coop.boss_clear', key: 'client-event', data: { boss: BOSSES[0] } }, session.gameToken);
    assert.equal(event.body.error, 'server_reason');
    assert.equal(event.body.tickets, undefined);
    const score = await call('score.submit', { boardId: 'coop_stage_clear_ms_v1', value: 10, meta: { boss: BOSSES[0] } }, session.gameToken);
    assert.equal(score.body.error, 'bad_board');
    const shooter = await call('tickets.earn', { amount: 20, reason: 'srv_shooter_boss_clear', key: 'shooter-still-blocked' }, session.gameToken);
    assert.equal(shooter.body.error, 'server_reason');
    const duel = await openGame(session.hub.token, 'sproto');
    const duelPay = await call('session.event', { eventId: 'sproto.boss_defeated', key: 'duel-still-pays', data: { boss: 'sahil' } }, duel.gameToken);
    assert.equal(Number(duelPay.body.tickets), PAY, JSON.stringify(duelPay.body));
    assert.equal(ticketBalance(session.hub.userId, 'sproto-coop-battle'), 0);
    assert.equal(ticketBalance(session.hub.userId, 'sproto'), PAY);
    assert.equal(credits(session.hub.userId), 0);
    assert.equal(scores(session.hub.userId), 0);
  });

  await test('coop', 'x100 retries, a delayed retry, both phases, and six local seats pay once', async () => {
    const session = await openCoop();
    const first = settle(session, BOSSES[0]!, 'room-six', 'enc-six', { slots: 4, assistance: 'all_human', clearMs: 18000 });
    assert.equal(first.paid, true, JSON.stringify(first));
    assert.equal(first.tickets, PAY);
    assert.equal(first.ticketsMinted, 0);
    assert.equal(first.slots, 4);
    assert.equal(first.phasesAreOneClear, 1);
    assert.equal(first.canonicalCount, 1);
    assert.equal(first.score, 18000);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-coop-battle'), PAY);
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(creditSum(session.hub.userId), PAY);
    assert.equal(scores(session.hub.userId, BOSSES[0]!), 1);
    assert.equal(receipts(session.hub.userId, BOSSES[0]!), 1);
    console.log(`coop ledger ${psql(`SELECT delta::text || ' ' || reason || ' ' || balance_after::text FROM game.tickets_ledger WHERE user_id = '${sqlId(session.hub.userId)}' AND game_id = 'sproto-coop-battle' ORDER BY event_id`)}`);
    console.log(`coop score ${psql(`SELECT variant || '=' || value::text || ' ' || (meta->>'assistance') FROM game.ranked_score WHERE user_id = '${sqlId(session.hub.userId)}' AND board_id = 'coop_stage_clear_ms_v1'`)}`);
    const sealedDay = psql(`SELECT day::text FROM game.coop_receipt WHERE user_id = '${sqlId(session.hub.userId)}' AND canonical_boss = '${BOSSES[0]}'`);
    assert.equal(first.day, sealedDay);
    for (let i = 0; i < 100; i++) {
      const again = settle(session, BOSSES[0]!, 'room-six', 'enc-six', { slots: 4, assistance: 'all_human', clearMs: 1000, day: '2099-01-01' });
      assert.equal(canonical(again), canonical(first), `retry ${i} ${JSON.stringify(again)}`);
    }
    await sleep(2000);
    const delayed = settle(session, BOSSES[0]!, 'room-six', 'enc-six', { slots: 4, assistance: 'all_human' });
    assert.equal(canonical(delayed), canonical(first));
    const phase = settle(session, `${BOSSES[0]}-p2`, 'room-phase', 'enc-phase');
    assert.equal(phase.tickets, 0, JSON.stringify(phase));
    assert.equal(phase.reason, 'unknown_boss');
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(scores(session.hub.userId), 1);
    assert.equal(receipts(session.hub.userId), 1);
    assert.equal(psql(`SELECT day::text FROM game.coop_receipt WHERE user_id = '${sqlId(session.hub.userId)}' AND canonical_boss = '${BOSSES[0]}'`), sealedDay);
  });

  await test('coop', '20 concurrent races, new keys, new rooms, and new sessions pay once', async () => {
    const session = await openCoop();
    const sql = settleSql(session, BOSSES[1]!, 'room-race', 'enc-race');
    const results = await Promise.all(Array.from({ length: 20 }, () => psqlAsync(sql)));
    const bodies = results.map((raw) => JSON.parse(raw) as Receipt);
    const winners = bodies.filter((body) => body.paid === true);
    assert.ok(winners.length >= 1, bodies.map((body) => JSON.stringify(body)).join('\n'));
    const sealed = canonical(winners[0]);
    for (const body of winners) assert.equal(canonical(body), sealed);
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(creditSum(session.hub.userId), PAY);
    assert.equal(scores(session.hub.userId, BOSSES[1]!), 1);
    assert.equal(receipts(session.hub.userId, BOSSES[1]!), 1);
    const otherRoom = settle(session, BOSSES[1]!, 'room-other', 'enc-other');
    assert.equal(otherRoom.paid, false, JSON.stringify(otherRoom));
    assert.equal(otherRoom.reason, 'already_paid');
    assert.equal(otherRoom.tickets, 0);
    const again = await openGame(session.hub.token, 'sproto-coop-battle');
    const otherSession = settle(again, BOSSES[1]!, 'room-session', 'enc-session');
    assert.equal(otherSession.tickets, 0, JSON.stringify(otherSession));
    assert.notEqual(otherSession.paid, true);
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(scores(session.hub.userId, BOSSES[1]!), 1);
    assert.equal(receipts(session.hub.userId, BOSSES[1]!), 1);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-coop-battle'), PAY);
  });

  await test('coop', 'god mode, practice, afk, late join, and cpu takeover seal a zero', async () => {
    const session = await openCoop();
    const cases: { reason: string; eligible: number }[] = [
      { reason: 'god_mode', eligible: 0 },
      { reason: 'practice', eligible: 0 },
      { reason: 'afk', eligible: 0 },
      { reason: 'late_join', eligible: 0 },
      { reason: 'cpu_takeover', eligible: 0 },
      { reason: 'stage_select', eligible: 0 },
      { reason: 'knocked_out', eligible: 0 },
    ];
    for (const item of cases) {
      const body = settle(session, BOSSES[2]!, `room-${item.reason}`, `enc-${item.reason}`, { reason: item.reason, eligible: item.eligible });
      assert.equal(body.tickets, 0, JSON.stringify(body));
      assert.equal(body.paid, false);
      assert.equal(body.reason, item.reason, JSON.stringify(body));
      const retry = settle(session, BOSSES[2]!, `room-${item.reason}`, `enc-${item.reason}`, { reason: 'clear', eligible: 1 });
      assert.equal(canonical(retry), canonical(body), item.reason);
    }
    assert.equal(credits(session.hub.userId), 0);
    assert.equal(scores(session.hub.userId), 0);
    assert.equal(receipts(session.hub.userId), 0);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-coop-battle'), 0);
  });

  await test('coop', '0063: the 0041 label is refused and a receipt carries the vendored sim label', async () => {
    const session = await openCoop();
    const user = session.hub.userId;
    const stale = settle(session, BOSSES[3]!, 'room-fp-old', 'enc-fp-old', { fingerprint: FP_0041 });
    assert.equal(stale.reason, 'bad_version', JSON.stringify(stale));
    assert.equal(stale.paid, false);
    assert.equal(stale.tickets, 0);
    assert.equal(credits(user), 0);
    assert.equal(receipts(user), 0);
    const paid = settle(session, BOSSES[3]!, 'room-fp-new', 'enc-fp-new');
    assert.equal(paid.paid, true, JSON.stringify(paid));
    assert.equal(paid.tickets, 20);
    assert.equal((paid as { fingerprint?: string }).fingerprint, FP);
    assert.equal(psql(`SELECT fingerprint FROM game.coop_receipt WHERE user_id = '${sqlId(user)}' AND canonical_boss = '${BOSSES[3]}'`), FP);
    assert.equal(psql(`SELECT meta->>'fingerprint' FROM game.ranked_score WHERE user_id = '${sqlId(user)}' AND board_id = 'coop_stage_clear_ms_v1' AND variant = '${BOSSES[3]}'`), FP);
    assert.equal(ticketBalance(user, 'sproto-coop-battle'), 20);
  });

  await test('coop', 'closed session, expired lease, and a replacement session do not duplicate', async () => {
    const closed = await openCoop();
    psql(`UPDATE game.game_session SET state = 'closed' WHERE session_id = '${sqlId(closed.sessionId)}'`);
    const denied = settle(closed, BOSSES[3]!, 'room-closed', 'enc-closed');
    assert.equal(denied.reason, 'session_closed', JSON.stringify(denied));
    assert.equal(denied.tickets, 0);
    const replay = settle(closed, BOSSES[3]!, 'room-closed', 'enc-closed');
    assert.equal(canonical(replay), canonical(denied));
    assert.equal(credits(closed.hub.userId), 0);
    assert.equal(receipts(closed.hub.userId), 0);
    const replacement = await openGame(closed.hub.token, 'sproto-coop-battle');
    const stolen = settle(replacement, BOSSES[3]!, 'room-closed', 'enc-closed', { sessionId: replacement.sessionId });
    assert.equal(canonical(stolen), canonical(denied), JSON.stringify(stolen));
    assert.equal(credits(closed.hub.userId), 0);
    const fresh = settle(replacement, BOSSES[3]!, 'room-fresh', 'enc-fresh');
    assert.equal(fresh.paid, true, JSON.stringify(fresh));
    assert.equal(credits(closed.hub.userId), 1);

    const leased = await openCoop();
    psql(`UPDATE game.game_session SET lease_until = now() - interval '1 second' WHERE session_id = '${sqlId(leased.sessionId)}'`);
    const expired = settle(leased, BOSSES[4]!, 'room-lease', 'enc-lease');
    assert.equal(expired.reason, 'session_closed', JSON.stringify(expired));
    assert.equal(credits(leased.hub.userId), 0);
    assert.equal(receipts(leased.hub.userId), 0);
    const missing = settle(leased, BOSSES[4]!, 'room-auth', 'enc-auth', { sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    assert.equal(missing.tickets, 0, JSON.stringify(missing));
    assert.equal(missing.reason, 'session_closed');
    assert.equal(credits(leased.hub.userId), 0);
  });

  await test('coop', 'utc day bucket stays on the terminal day and the next day pays again', async () => {
    const session = await openCoop();
    const today = settle(session, BOSSES[5]!, 'room-utc', 'enc-utc');
    assert.equal(today.paid, true, JSON.stringify(today));
    const stored = today.day ?? '';
    assert.match(stored, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
    psql(`UPDATE game.coop_receipt SET day = (now() AT TIME ZONE 'utc')::date - 1 WHERE user_id = '${sqlId(session.hub.userId)}' AND canonical_boss = '${BOSSES[5]}'`);
    psql(`UPDATE game.earn_window SET day = (now() AT TIME ZONE 'utc')::date - 1 WHERE user_id = '${sqlId(session.hub.userId)}' AND bucket = 'boss:sproto-coop-battle:${BOSSES[5]}'`);
    const sameTerminal = settle(session, BOSSES[5]!, 'room-utc', 'enc-utc');
    assert.equal(canonical(sameTerminal), canonical(today), JSON.stringify(sameTerminal));
    assert.equal(credits(session.hub.userId), 1);
    const next = settle(session, BOSSES[5]!, 'room-utc-next', 'enc-utc-next');
    assert.equal(next.paid, true, JSON.stringify(next));
    assert.equal(receipts(session.hub.userId, BOSSES[5]!), 2);
    assert.equal(credits(session.hub.userId), 2);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-coop-battle'), 40);
    const third = settle(session, BOSSES[5]!, 'room-utc-third', 'enc-utc-third');
    assert.equal(third.tickets, 0, JSON.stringify(third));
    assert.equal(third.reason, 'already_paid');
    assert.equal(credits(session.hub.userId), 2);
  });

  await test('coop', 'session cap stops the 240 sweep at 200 and the daily cap stops the rest', async () => {
    const session = await openCoop();
    for (let i = 0; i < 10; i++) {
      const body = settle(session, BOSSES[i]!, `sweep-${i}`, `enc-sweep-${i}`);
      assert.equal(body.paid, true, `${BOSSES[i]} ${JSON.stringify(body)}`);
      assert.equal(body.tickets, PAY);
    }
    assert.equal(ticketBalance(session.hub.userId, 'sproto-coop-battle'), 200);
    assert.equal(credits(session.hub.userId), 10);
    const eleventh = settle(session, BOSSES[10]!, 'sweep-10', 'enc-sweep-10');
    assert.equal(eleventh.error, 'session_ticket_cap', JSON.stringify(eleventh));
    assert.equal(eleventh.tickets, 0);
    const twelfth = settle(session, BOSSES[11]!, 'sweep-11', 'enc-sweep-11');
    assert.equal(twelfth.error, 'session_ticket_cap', JSON.stringify(twelfth));
    assert.equal(credits(session.hub.userId), 10);
    assert.equal(creditSum(session.hub.userId), 200);
    assert.equal(scores(session.hub.userId), 10);
    assert.equal(receipts(session.hub.userId), 10);
    const later = await openGame(session.hub.token, 'sproto-coop-battle');
    const already = settle(later, BOSSES[0]!, 'sweep-new-room', 'enc-sweep-new');
    assert.equal(already.reason, 'already_paid', JSON.stringify(already));
    assert.equal(already.tickets, 0);
    const unpaid = settle(later, BOSSES[10]!, 'sweep-eleven', 'enc-sweep-eleven');
    assert.equal(unpaid.paid, true, JSON.stringify(unpaid));
    assert.equal(credits(session.hub.userId), 11);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-coop-battle'), 220);

    const daily = await openCoop();
    psql(`INSERT INTO game.earn_window (user_id, bucket, day, amount) VALUES ('${sqlId(daily.hub.userId)}', 'tickets:sproto-coop-battle', (now() AT TIME ZONE 'utc')::date, 990)`);
    const blocked = settle(daily, BOSSES[0]!, 'daily-room', 'daily-enc');
    assert.equal(blocked.error, 'daily_ticket_cap', JSON.stringify(blocked));
    assert.equal(credits(daily.hub.userId), 0);
    assert.equal(receipts(daily.hub.userId), 0);
    const roomy = await openCoop();
    psql(`INSERT INTO game.earn_window (user_id, bucket, day, amount) VALUES ('${sqlId(roomy.hub.userId)}', 'tickets:sproto-coop-battle', (now() AT TIME ZONE 'utc')::date, 980)`);
    const one = settle(roomy, BOSSES[0]!, 'daily-one', 'daily-one-enc');
    assert.equal(one.paid, true, JSON.stringify(one));
    const two = settle(roomy, BOSSES[1]!, 'daily-two', 'daily-two-enc');
    assert.equal(two.error, 'daily_ticket_cap', JSON.stringify(two));
    assert.equal(credits(roomy.hub.userId), 1);
    assert.equal(receipts(roomy.hub.userId), 1);
    assert.equal(ticketBalance(roomy.hub.userId, 'sproto-coop-battle'), PAY);
  });

  await test('coop', 'restart keeps the receipt and a wallet fault leaves no partial', async () => {
    installFaultHooks();
    try {
      const committed = await openCoop();
      const first = settle(committed, BOSSES[6]!, 'room-commit', 'enc-commit');
      assert.equal(first.paid, true, JSON.stringify(first));
      assert.equal(credits(committed.hub.userId), 1);
      assert.equal(scores(committed.hub.userId, BOSSES[6]!), 1);
      assert.equal(receipts(committed.hub.userId, BOSSES[6]!), 1);
      compose(['restart', 'nakama']);
      await waitRestart();
      const owned = psql(`SELECT user_id::text || ' ' || session_id::text || ' ' || tickets::text || ' ' || day::text FROM game.coop_receipt WHERE user_id = '${sqlId(committed.hub.userId)}' AND canonical_boss = '${BOSSES[6]}'`);
      assert.equal(owned, `${committed.hub.userId} ${committed.sessionId} 20 ${first.day}`);
      const recovered = settle(committed, BOSSES[6]!, 'room-commit', 'enc-commit');
      assert.equal(canonical(recovered), canonical(first), JSON.stringify(recovered));
      assert.equal(credits(committed.hub.userId), 1);
      assert.equal(scores(committed.hub.userId, BOSSES[6]!), 1);
      assert.equal(receipts(committed.hub.userId, BOSSES[6]!), 1);

      let rolled: GameLogin | null = null;
      const authDeadline = Date.now() + 60_000;
      let authError = 'not attempted';
      while (Date.now() < authDeadline) {
        try {
          rolled = await openCoop();
          break;
        } catch (error) {
          authError = error instanceof Error ? error.message : String(error);
          if (!/503|ECONNREFUSED|connection refused/.test(authError)) throw error;
          await sleep(500);
        }
      }
      if (!rolled) throw new Error(authError);
      arm(rolled.hub.userId, 'earn.after_wallet', 'raise');
      try {
        settle(rolled, BOSSES[0]!, 'room-fault', 'enc-fault');
        assert.fail('wallet fault did not abort the settlement');
      } catch (error) {
        const err = error as { message?: string; stderr?: string | Buffer };
        const text = `${err.message ?? ''}\n${err.stderr ?? ''}`;
        assert.match(text, /fault_injected/);
      }
      assert.equal(credits(rolled.hub.userId), 0);
      assert.equal(receipts(rolled.hub.userId), 0);
      assert.equal(scores(rolled.hub.userId), 0);
      assert.equal(num(`SELECT count(*) FROM game.coop_eligibility WHERE user_id = '${sqlId(rolled.hub.userId)}'`), 0);
      assert.equal(ticketBalance(rolled.hub.userId, 'sproto-coop-battle'), 0);
      disarm(rolled.hub.userId);
      const retry = settle(rolled, BOSSES[0]!, 'room-fault', 'enc-fault');
      assert.equal(retry.paid, true, JSON.stringify(retry));
      assert.equal(credits(rolled.hub.userId), 1);
      assert.equal(scores(rolled.hub.userId, BOSSES[0]!), 1);
      assert.equal(receipts(rolled.hub.userId, BOSSES[0]!), 1);
      const again = settle(rolled, BOSSES[0]!, 'room-fault', 'enc-fault');
      assert.equal(canonical(again), canonical(retry));
      assert.equal(credits(rolled.hub.userId), 1);
    } finally {
      dropFaultHooks();
    }
  });
}
