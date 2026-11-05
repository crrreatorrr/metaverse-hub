# NOBU Chapter 2 trial boards (H70 preparation)

Preparatory Hub branch from `1c5ff75d8730d594147e0b8935ec0d23397472b1`. H45/H50 and client activation
remain pending coordinator confirmation, and the owner has not confirmed deployment of this Hub
capability. This branch does not enable Nobu uploads or change production. A merge alone is not
proof that these variants are deployed.

| Exact variant | Inclusive minimum (integer ms) |
| --- | ---: |
| `4` | 24000 |
| `6` | 30000 |
| `5` | 21000 |

All use the existing ascending `nobu_trial_time` board and inclusive 1800000ms ceiling. Classic
`1`/`2`/`3` and extended `1v2`/`2v2`/`3v2` floors stay unchanged. `4v2`/`5v2`/`6v2`, missing variants
and prototype names remain invalid. Number/string level inputs normalize to the same row and rate
window. No SQL/schema, session, God-mode, economy or grant policy changes are introduced.

The SDK's shared floor allow-list changes because its mock submit/read paths use that table; live
wire signatures/routing need no change. SDK version **0.6.1 is preserved**, including the newer
outbox/pet/schema work on the base commit. Nobu is the required SDK consumer to re-sync after the Hub
change is merged and owner-deployed; use `node scripts/vendor-sdk.mjs <fresh-nobu-worktree> --branch main`
from exact merged Hub main, never hand-edit its vendor files. This branch does not vendor anything.
Other games' boards do not need a functional re-sync for these NOBU-only variants.

Plaza wall order is current `1v2`, `2v2`, `3v2`, `4`, `6`, `5`, then Classic `1`, `2`, `3`. Each new page
has an exhaustive NOBU game mapping and integer-ms stub data. The portal preview remains `1v2`.
The existing game-wide NOBU `level_end` rule still caps a chunk at20 and has no level-id allow-list;
leaderboard submission adds no Ticket path.

## Validation

- `npm ci`: passed, 130 packages.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`: all passed.
- The offline test command runs three SDK scripts, capsule simulation, plaza net suite and eight
  server test files (13 executable test/simulation files); it has no unified assertion-case counter.
  Added cases cover new floor/ceiling/fraction boundaries, numeric/string normalization, full SQL
  variant and rate isolation, God rejection, no active SDK session, mock/live wire parity, no grants,
  plaza order/titles/stubs and prototype/version rejection. Classic/v2 regressions remain.
- Real Nakama3.41/Postgres16.8: `DUP_ONLY=nobu npm run test:dup` passed **5 cases** (4 score,1 wallet),
  including the new Chapter 2 case. It writes/reads all three new floors beside Classic/v2 rows in a
  fresh account, checks every own row after all writes, and preserves economy snapshots/earn-ledger
  counts. The pre-existing H35 fixture's four-row assertion stays unchanged in its separate account.
- Separate SQL economy audit passed. The local test image copied the already-built exact module into
  the official Nakama image; no Dockerfile/deploy/permission edits were needed. The throwaway project
  `h70-nobu-tests`, its containers/network/volume and newly generated local env file were removed.
  Docker credentials/config were preserved; only its Buildx cache used a writable temporary path.
- Production build transforms140 modules and passes its no-debug-globals check. Usual bundle-size
  warnings remain. `git diff --check` passed.

Logs are `/tmp/h70-{install,lint,typecheck,test,build,dup-nobu,economy-audit,compose-down}.log`.
The full unfiltered real duplication matrix and realtime Docker suite were not run locally; exact PR
and merged-main CI must still validate them. Independent agent review is pending.

## Gates and manual checks still outstanding

The Nobu follow-up must wait for merged H40/H45/H50, the new Hub PR and **owner deployment confirmation**.
Only then re-vendor the SDK and activate exact variants4/6/5 using existing config/queue/bridge gates;
predeploy trials must remain local with no queued upload. This does not authorize changing the separate
L1–3 `HUB_LAYOUT` deployment gates. Check floors against final merged physical gate/goal geometry,
including raft current/chute speed bounds, in the later Nobu integration.

Manual phone/desktop plaza wall display and one real **hub-launched** L4,L6,L5 trial posting/reading
its own board remain unrun. Those runs also need to confirm gear-free/noDDA and no God/remix/rush
upload behavior after deployment. No PR, push, merge, production deployment, permission change,
leaderboard reset, new media or client gate change is performed by this preparatory branch.

Sources: Nobu H70/H35 handoffs, gameplay plan10.2, new-levels wiring5.1 and level6§9 in the reviewed
`/workspace/nobu-spec` source material, plus current Hub `AGENTS.md`.
