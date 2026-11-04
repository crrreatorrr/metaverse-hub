# Realtime: plaza, chat and game servers

The hub runs one Nakama OSS node. Realtime pieces are authoritative matches (one goroutine and one JS VM each), Nakama chat channels, and RPCs. This page is the guide for the hub and for the game agents that add server code here. The frozen contract (ids, file ownership, registries, labels, SDK types) is the "CONTRACT" section of the hub realtime plan; the rules below restate it.

## Ids

| Thing | Values |
| --- | --- |
| Game ids (`ctx.vars.game`, matchmaker `properties.game`, label `game`) | `nobu`, `sproto` (Sproto Duel), `sproto-fighter`, `peoples-bitcoin`, `hpos10i`. The plaza is scope `hub` with no game. `sproto-duel` is never an id. |
| Match modules | `hub` (plaza), `sproto_duel` (Sproto Fighter, existing), `sproto_arena` (Sproto Duel), `pb_world` (People's Bitcoin) |
| RPCs | hub: `hub.join`, `leaderboard.top`, `chat.report`, `score.submit`. Sproto Duel: `sproto.room_create`, `sproto.room_join`. PB: `pb.worlds`. New ids are prefixed by their owner (`hub.`, `chat.`, `sproto.`, `pb.`). |
| Migrations | hub `0011`–`0012`, peoples-bitcoin `0013`–`0019`, sproto `0020`–`0024` |

## SDK (`@metaverse/hub-sdk` 0.5.0)

Games use `realtimeFromSdk(sdk)` after `init(game)`. It returns `null` standalone, so the game stays offline. See `packages/hub-sdk/README.md` § Realtime for the API (`joinMatch`, `joinViaRpc`, `addMatchmaker`, `joinChat`, `rpc`, reconnect semantics) and `createMockRealtimeServer` for unit tests. Game-specific transports (Sproto's flat `send`, PB's `rt.send(op, data)`) are adapters in the game repo over `MatchHandle`.

`MatchHandle.send` is a synchronous enqueue (no Promise per call). Server hook errors arrive as `HubSdkError` whose code is parsed from `Error: <code> at …`; a rejected match join is `match_rejected:<rejectMessage>`.

Vendor the SDK into a game repo with `npm run vendor:sdk -- /path/to/game-repo [--branch <name>]` (builds, copies `dist/**/*.js` + `.d.ts` without maps, rewrites the VENDOR.md header, prints the manifest).

## Adding a game's server code

A game file in `server/modules/src/games/` is compiled by the tsconfig `include` (after every hub file, alphabetically), so it is not listed anywhere. Vendor bundles in `server/modules/vendor/*.js` are appended in alphabetical order.

```ts
// server/modules/src/games/sproto_arena.ts
namespace SprotoArena {
  export var MATCH_NAME = "sproto_arena";
  export var handler: nkruntime.MatchHandler<State> = { /* matchInit … matchSignal */ };
  export function onMatched(ctx, logger, nk, matches): string | void { return nk.matchCreate(MATCH_NAME, { /* … */ }); }
  export function rpcRoomCreate(ctx, logger, nk, payload): string { /* … */ }
}
// Nakama resolves handlers by global function name: top-level named wrappers.
function sprotoArenaInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [k: string]: unknown }) {
  return SprotoArena.handler.matchInit(ctx, logger, nk, params);
}
// … sprotoArenaJoinAttempt, Join, Leave, Loop, Terminate, Signal, rpcSprotoRoomCreate, rpcSprotoRoomJoin
HubGames.register({ game: "sproto", matchmaker: SprotoArena.onMatched });
HubSchema.register({ id: "0020_sproto_pvp", statements: [ /* … */ ] });
```

Then, only between the game's markers in `InitModule` (`server/modules/src/main.ts`):

```ts
  // >>> game: sproto (Sproto Duel) registrations
  initializer.registerMatch("sproto_arena", { matchInit: sprotoArenaInit, matchJoinAttempt: sprotoArenaJoinAttempt, matchJoin: sprotoArenaJoin, matchLeave: sprotoArenaLeave, matchLoop: sprotoArenaLoop, matchTerminate: sprotoArenaTerminate, matchSignal: sprotoArenaSignal });
  initializer.registerRpc("sproto.room_create", rpcSprotoRoomCreate);
  initializer.registerRpc("sproto.room_join", rpcSprotoRoomJoin);
  // <<< game: sproto
```

Rules:

- Registration calls must sit lexically inside `InitModule`, and each handler argument must be the identifier of a top-level function (Nakama parses `InitModule` to find them). The unit harness checks this.
- Matchmaker routing goes through `HubGames.register({ game, matchmaker })`; `main.ts` owns the single `registerMatchmakerMatched` hook, which routes by `matches[0].properties.game` and creates nothing when entries disagree.
- Game agents do not edit `tsconfig.json`, `append-vendor.mjs`, `package.json`, `nakama.d.ts`, `sproto_nakama.d.ts`, `schema.ts` or `rpcs.ts`. Extra typings go in `games/<game>_nakama.d.ts` by interface merging: `declare namespace nkruntime { interface Nakama { … } }`.
- Migrations: `HubSchema.register({ id, statements })` at top level of the game file, inside the game's id range. The runner refuses an unapplied id below the highest recorded one, so PRs merge and deploy in id order (hub, then PB, then sproto), or a late PR renumbers above the highest recorded id first.

## Shared server helpers

| Namespace | File | Use |
| --- | --- | --- |
| `HubGames` | `hub_games.ts` | `register`, `matchmakerFor`, `roomAllowed`, `matchmakingAllowed`, `list` |
| `HubSchema` | `schema.ts` | `register`, `all` (sorted), `apply` |
| `HubEconomy` | `server_economy.ts` | `earn`, `spend`, `sell`, `balance` with `{ userId, sid, game }` |
| `HubBoards` | `leaderboard.ts` | `recordWin(nk, userId, boardId, matchId)`: server-only +1, idempotent per match |
| `HubShards` | `shards.ts` | `place(nk, logger, { module, kind, max, softMax, params?, preferMatchId? })` |
| `HubChat` | `chat_guard.ts` | channel join/send guard (validation, rate limit, mute, filter) |
| `HubRt` | `rt_hooks.ts` | matchmaker dispatcher, `MatchmakerAdd` / `MatchCreate` before-hooks |

Ticket crediting from a match goes through `HubEconomy` only:

- `sid` is the joiner's `ctx.vars.sid`, captured in `matchJoinAttempt`.
- Server-only reasons start with `srv_` (for example `srv_pvp_win`). The public `tickets.earn` RPC rejects them with `server_reason`. Each game adds its own `game.event_rule` rows in its migration range.
- Keys are deterministic per real-world event (`sproto:pvp:<matchId>:<userId>`) and sealed before the call, so a retry reuses the same key and amount; `game.idempotency` makes it exactly-once (`idempotency_mismatch` if the amount changes).
- Earns need the game session to be open (6 h lease from portal entry; entering another portal closes it). On `session_closed`, keep the amount pending and tell the client.

`sproto_wins` is server-only: `score.submit` answers `{ accepted: false, reason: 'server_board' }`, and only `recordWin` writes it.

## Labels and placement

Every authoritative label is JSON with `game` and `kind`:

| Match | Label |
| --- | --- |
| Hub | `{"game":"hub","kind":"hub","shard":N,"players":n,"max":100,"open":bool}` |
| Sproto Duel | `{"game":"sproto","kind":"sproto_arena","v":"<NET_VERSION>","open":bool,"code":"ABC234"|""}` |
| PB | `{"game":"peoples-bitcoin","kind":"pb_world","world":N,"players":n,"max":100,"open":bool,"sim":"<PB_SIM_VERSION>"}` |

- Query booleans as `+label.open:T` (`:true` matches nothing). Numeric ranges work (`+label.players:<90`). Query by `+label.kind:<kind>`.
- A new match shows in `matchList` about 1 s after `matchCreate`, so placement returns the id it created. Use the listing's live `size` for fullness; the label count lags.
- `nk.matchCreate` works inside `InitModule` (hub shard 1, PB worlds at boot).
- Placement is least-full open instance (`size < softMax`).

Opcodes are per match; each match owns its whole opcode space.

## Scopes

| Session | `ctx.vars` | May |
| --- | --- | --- |
| Hub (device or email auth) | `{ scope: "hub" }` | join `hub` matches, chat in `hub.<shard>`, DMs, groups; matchmake only for games registered with `hubScope` (Sproto Fighter) |
| Game (portal ticket) | `{ scope: "game", game, sid, ranked }` | matchmake with `properties.game === ctx.vars.game`; join its game's matches; chat only in rooms its game registered (none in this round) |

`ctx.vars` is `null` for sessions without vars, so guard it. RT before-hook envelopes are camelCase (`envelope.channelJoin.target`, `envelope.matchmakerAdd.stringProperties`); throwing rejects the request. Clients cannot create relayed matches (`MatchCreate` is rejected).

## Runtime constraints (goja)

No `TextEncoder`/`TextDecoder`, `crypto`, `structuredClone`, `fetch` or `setTimeout`. `globalThis`, `new Function`, regex lookbehind and named groups, class fields and `?.`/`??` work. `localcachePut` accepts only strings, numbers and booleans (store JSON strings). `broadcastMessage` accepts strings and `ArrayBuffer`. Each match VM evaluates the whole `index.js`, so vendor bundles must parse content lazily.

## Tests

`npm test` runs `server/test/unit/run.ts`, which builds the module once and then runs every `server/test/unit/*.test.ts` and `server/test/games/*.test.ts` (game agents add files there; `package.json` is not edited).

```ts
import assert from 'node:assert/strict';
import { checkRegistrations, loadModule, plain, presence } from '../unit/harness';

const mod = loadModule();                                    // runs InitModule against a fake nk
assert.deepEqual(checkRegistrations(mod.source).issues, []);
mod.nk.onSql('game.earn_tickets', () => [{ result: '{"balance":20}' }]);   // scripted SQL
const m = mod.startMatch('sproto_arena', { players: '[]' });  // nk.matchCreate + driver
m.join([presence('u1')], { vars: { scope: 'game', game: 'sproto', sid: '…' } });
m.loop([{ sender: presence('u1'), opCode: 1, data: { v: 3 } }]);
assert.equal(m.dispatcher.sent(2).length, 1);
const out = mod.call('sproto.room_create', { userId: 'u1', vars: { scope: 'game', game: 'sproto', sid: '…' } }, { v: 3 });
const routed = mod.matchmake([{ presence: presence('a'), properties: { game: 'sproto' } }, { presence: presence('b'), properties: { game: 'sproto' } }]);
```

The module runs in `node:vm` with only ES built-ins. Values that come out of the vm realm need `plain()` before `assert.deepEqual`. The fake `nk` covers SQL (scripted), localcache (throws on objects), storage with OCC versions, `matchCreate`/`matchList`/`matchGet`/`matchSignal`, accounts, users, friends and notifications.

Docker (hub agent only; compose ports and project name collide between worktrees): `npm run test:dup` and `npm run test:rt` against `server/docker-compose.yml`. A game agent that wants a live smoke uses plain `docker run` with its own names and port (`pg-<game>`/`nk-<game>` on `net-<game>`, Nakama on host port 7360 for sproto or 7370 for PB) and removes the containers afterwards.
