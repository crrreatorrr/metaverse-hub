# Sproto Fighter gameplay bundle refresh

The generated verifier bundle matches Fighter simulation `7d0ce00ef52b567a`
from the staged gameplay implementation ending at Fighter PR #29. This replaces
hub main's `dc3a64b592b94faf`; Fighter main was already at `af94139cc59e4dfd`.
This is a reviewable source refresh, not a production deployment.

The client and verifier must be released as a matching pair. Optional local
round rules remain disabled online; the bundle includes the same seeded CPU
state advancement needed for deterministic input-only replay.

Validation on this bundle: hub typecheck, tests, build and lint pass. A local
Nakama 3.41.0/Postgres stack replayed five logs with exact Node winner, end frame
and state hash equality, rejecting mismatched/malformed logs. Four live relay
wager/forfeit groups pass. Two Chromium clients completed a verified wager and
rematch with Tickets conserved and experimental round flags disabled. Direct
WebRTC was not established in this environment; no claim is made for TURN or a
production hub. Test accounts and dev keys were local and were not committed.

Roster fairness and story difficulty calibration are still draft criteria in
the Fighter repository. No source SDK contract or hub economy rule was changed.
