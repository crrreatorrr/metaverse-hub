# Sproto Fighter gameplay bundle refresh

The generated verifier bundle matches Fighter simulation `a4c7ddde49ec5a64`
from the gameplay implementation merged through Fighter PR #30 at
`b3499355922f85095e2409f7c170e264a5d3910c` (subsequent cinematic main
`65ed5dba85980700d0f83f3ab5dbf4ccbe8c6a24` has the same simulation). This replaces
hub main's `af94139cc59e4dfd` from PR #60. The earlier hub baseline was
`dc3a64b592b94faf`; Fighter main previously used `af94139cc59e4dfd`.
The source merge is authorized; production deployment is separate.

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

Roster fairness and story difficulty acceptance remain unmet in the Fighter
repository (12/7 Normal/Hard fighters outside 35–65%; opening 1/256 and finale
131/256 CPU wins against the unchanged reference). Human playtesting, transformed
boss difficulty/modifiers and direct WebRTC remain unverified. No source SDK contract or hub economy rule was changed.

The pin and CI guard from hub PR #60 are retained. The pin now names current
Fighter main so that local hash, HELLO, pinned source and live-main checks agree.
