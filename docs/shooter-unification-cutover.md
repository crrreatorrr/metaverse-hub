# Sproto Shooter → Sproto Open World Cutover (U6)

`sproto-shooter` has been unified into `Sproto-Open-World` as the single flagship game (9 fixed guns with Dual Wield, all 10 campaign dungeons `L01–L10` with walkable overworld portals and Brick Phone fast travel, 4 playable classes with Lv 30 progression, mixed 6-region overworld camps/bosses, and Free 1v1 PvP Arena).

## Hub Client Status
- `apps/hub/src/game-list.ts` lists `sproto-open-world` as the unified Action RPG & shooter flagship and marks standalone `sproto-shooter` as legacy.
- Existing `sproto-shooter` plaza ring, `dragon_scale` relic, and `play_lease` surface remain intact so existing accounts and tests stay backwards-compatible until full standalone retirement.

## Nakama Server PvP Sim v3 Cutover Checklist (Production)
When ready to switch Nakama Free 1v1 PvP from `sproto-shooter` Sim v2 (`e749d2fd`, with Second Wind) to `Sproto-Open-World` Sim v3 (`1796df6e`, no Second Wind):
1. Build `build/shooter-pvp-sim.js` and `build/shooter-pvp-sim.pin.json` in `Sproto-Open-World` via `npm run build:pvp-sim`.
2. Vendor both into `server/modules/vendor/` and update `scripts/check-shooter-pvp-sim-version.mjs` (`REPO = 'crrreatorrr/Sproto-Open-World'`, `SIM = 3`, `FINGERPRINT = '1796df6e'`).
3. Update `server/modules/src/games/shooter_protocol.ts` and `shooter_match.ts` to accept `SIM = 3` and `GAME_ID = 'sproto-open-world'`.
4. Run `npm run lint && npm run typecheck && npm test && npm run test:dup && npm run build` with Nakama running from `server/docker-compose.yml`.
