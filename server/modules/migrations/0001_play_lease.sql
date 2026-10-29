-- Migration 0001. No numbered migration exists yet: Nakama boot applies
-- server/modules/src/schema.ts from InitModule, and `nakama migrate up` does
-- not read this directory. Apply this file only in the follow-up described
-- in docs/m11-single-active-tab.md, after hub #12 and #13 have merged.
--
-- One active tab per profile. The newest session.claim replaces lease_id.
-- Clients heartbeat about every 15 seconds. A lease older than 45 seconds
-- is stale. Every timestamp is Postgres now(); a client clock is never stored.

CREATE SCHEMA IF NOT EXISTS game;

CREATE TABLE IF NOT EXISTS game.play_lease (
  user_id uuid PRIMARY KEY,
  lease_id uuid NOT NULL,
  surface text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT play_lease_surface CHECK (
    surface IN ('hub', 'hpos10i', 'nobu', 'peoples-bitcoin', 'sproto')
  ),
  CONSTRAINT play_lease_lease_id_key UNIQUE (lease_id)
);

-- Newest claim wins. One row per user; every call mints a new lease_id.
-- Keep heartbeatSeconds / ttlSeconds equal to HubLease.HEARTBEAT_SECONDS
-- and HubLease.TTL_SECONDS in server/modules/src/play_lease.ts.
CREATE OR REPLACE FUNCTION game.claim_play_lease(p_user_id uuid, p_surface text)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_prev uuid;
  v_lease uuid;
  v_at timestamptz;
BEGIN
  IF p_surface NOT IN ('hub', 'hpos10i', 'nobu', 'peoples-bitcoin', 'sproto') THEN
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
$fn$;

-- Refreshes heartbeat_at only when this lease is still inside the 45 second TTL.
-- A miss updates zero rows.
CREATE OR REPLACE FUNCTION game.heartbeat_play_lease(p_user_id uuid, p_lease_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_at timestamptz;
BEGIN
  UPDATE game.play_lease
     SET heartbeat_at = now()
   WHERE user_id = p_user_id
     AND lease_id = p_lease_id
     AND heartbeat_at >= now() - interval '45 seconds'
  RETURNING heartbeat_at INTO v_at;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'session_superseded');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'leaseId', p_lease_id,
    'heartbeatAt', v_at
  );
END;
$fn$;

-- Lock the profile row and raise session_superseded when the lease is missing,
-- different, or older than 45 seconds. This function writes no lease row.
-- Call it inside the same plpgsql function as the ledger write, after the
-- advisory lock and before any INSERT (including game.idempotency). A raise
-- aborts that transaction, so the stale call leaves no ledger row.
-- nk.sqlQuery runs one statement at a time, so the TypeScript helper cannot
-- hold this row lock across a later write.
CREATE OR REPLACE FUNCTION game.require_lease(p_user_id uuid, p_lease_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_lease uuid;
  v_heart timestamptz;
BEGIN
  SELECT lease_id, heartbeat_at
    INTO v_lease, v_heart
  FROM game.play_lease
  WHERE user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_lease IS DISTINCT FROM p_lease_id
     OR v_heart < now() - interval '45 seconds' THEN
    RAISE EXCEPTION 'session_superseded' USING ERRCODE = 'P0001';
  END IF;
  RETURN true;
END;
$fn$;
