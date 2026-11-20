// Sproto Open World (crrreatorrr/Sproto-Open-World).
//
// Plaza ring beside the Range (Sproto Shooter). Browser action RPG: staff and magic, quests, bosses.
// No Relic, no client Ticket earn, no leaderboard and no client events. It uses only the portal
// ticket (game session), the generic save.get / save.put, session.close, the play lease, presence
// and feedback. It registers no RPC or match of its own.
//
// 0077 widens every game-id check a session, ticket or lease for this game hits: game_session,
// auth_ticket, play_lease.surface and game.claim_play_lease (0074). game_beaten and the Relic
// checks stay: this game grants no Relic. The lists keep vcoin.
namespace SprotoOpenWorld {
  export var GAME_ID = "sproto-open-world";
  export var ENTRY = "ring";
}

HubGames.register({ game: SprotoOpenWorld.GAME_ID });

HubSchema.register({
  id: "0077_sproto_open_world",
  statements: [
    "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
    "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter', 'sproto-coop-battle', 'sproto-open-world'))",
    "ALTER TABLE game.auth_ticket DROP CONSTRAINT IF EXISTS auth_ticket_game",
    "ALTER TABLE game.auth_ticket ADD CONSTRAINT auth_ticket_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter', 'sproto-coop-battle', 'sproto-open-world'))",
    "ALTER TABLE game.play_lease DROP CONSTRAINT IF EXISTS play_lease_surface",
    "ALTER TABLE game.play_lease ADD CONSTRAINT play_lease_surface CHECK (surface IN ('hub', 'hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle', 'sproto-open-world', 'vcoin'))",
    // 0074's claim_play_lease with the new surface in its list. Nothing else in the body changes.
    `CREATE OR REPLACE FUNCTION game.claim_play_lease(p_user_id uuid, p_surface text)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_prev uuid;
  v_lease uuid;
  v_at timestamptz;
BEGIN
  IF p_surface NOT IN ('hub', 'hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle', 'sproto-open-world', 'vcoin') THEN
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
