// Sproto Racer (crrreatorrr/Sproto-Racer).
//
// Plaza ring beside Sproutvale (Sproto Open World), on the Green Hill side of the Range.
// Browser kart racer: Quick Race, Time Trial and Test Drive. Time-trial records live in the
// cloud save (save.get / save.put), which accepts one JSON object of at most 16384 bytes.
// No Relic of its own, no client Ticket earn and no leaderboard. A game session reads the Relics
// the hub account already owns (`profile.get`, which `init` uses): known ids in `relics`, newer
// ids in `otherRelics`. Which of those unlock a car or a character is decided in the game, later.
// It uses the portal ticket, the generic save, session.close, the play lease, presence and
// feedback. It registers no RPC or match of its own.
//
// 0081 widens every game-id check a session, ticket or lease for this game hits: game_session,
// auth_ticket, play_lease.surface and game.claim_play_lease (0077). game_beaten and the Relic
// checks stay. The lists keep vcoin.
namespace SprotoRacer {
  export var GAME_ID = "sproto-racer";
  export var ENTRY = "ring";
}

HubGames.register({ game: SprotoRacer.GAME_ID });

HubSchema.register({
  id: "0081_sproto_racer",
  statements: [
    "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
    "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter', 'sproto-coop-battle', 'sproto-open-world', 'sproto-racer'))",
    "ALTER TABLE game.auth_ticket DROP CONSTRAINT IF EXISTS auth_ticket_game",
    "ALTER TABLE game.auth_ticket ADD CONSTRAINT auth_ticket_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter', 'sproto-coop-battle', 'sproto-open-world', 'sproto-racer'))",
    "ALTER TABLE game.play_lease DROP CONSTRAINT IF EXISTS play_lease_surface",
    "ALTER TABLE game.play_lease ADD CONSTRAINT play_lease_surface CHECK (surface IN ('hub', 'hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle', 'sproto-open-world', 'sproto-racer', 'vcoin'))",
    // 0077's claim_play_lease with the new surface in its list. Nothing else in the body changes.
    `CREATE OR REPLACE FUNCTION game.claim_play_lease(p_user_id uuid, p_surface text)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_prev uuid;
  v_lease uuid;
  v_at timestamptz;
BEGIN
  IF p_surface NOT IN ('hub', 'hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle', 'sproto-open-world', 'sproto-racer', 'vcoin') THEN
    RETURN jsonb_build_object('error', 'bad_surface');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('play_lease:' || p_user_id::text, 0));
  SELECT lease_id INTO v_prev
  FROM game.play_lease
  WHERE user_id = p_user_id
  FOR UPDATE;
  v_lease := gen_random_uuid();
  v_at := now();
  INSERT INTO game.play_lease (user_id, lease_id, surface, claimed_at, heartbeat_at)
  VALUES (p_user_id, v_lease, p_surface, v_at, v_at)
  ON CONFLICT (user_id) DO UPDATE
    SET lease_id = EXCLUDED.lease_id,
        surface = EXCLUDED.surface,
        claimed_at = EXCLUDED.claimed_at,
        heartbeat_at = EXCLUDED.heartbeat_at;
  RETURN jsonb_build_object(
    'ok', true,
    'leaseId', v_lease,
    'surface', p_surface,
    'claimedAt', v_at,
    'heartbeatAt', v_at,
    'previousLeaseId', v_prev,
    'superseded', v_prev IS NOT NULL,
    'heartbeatSeconds', 15,
    'ttlSeconds', 45
  );
END;
$fn$`,
  ],
});
